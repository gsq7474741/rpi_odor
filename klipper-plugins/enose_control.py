# E-Nose Klipper Plugin v2.0
# 提供蠕动泵的异步停止功能
#
# 命令:
# - ENOSE_ASYNC_STOP: 立即停止所有泵（绕过 G-code 队列，~1秒延迟）
# - ENOSE_STATUS: 报告插件状态
#
# 用法: 在 printer.cfg 中添加 [enose_control]
#
# 工作原理:
# - 使用 reactor.register_async_callback() 立即执行停止
# - 重置 motion_queuing 时间变量阻止后续步进生成
# - 清空 trapq 并取消 GCODE_AXIS 注册
# - 禁用电机

import logging

class EnoseControl:
    def __init__(self, config):
        self.printer = config.get_printer()
        self.gcode = self.printer.lookup_object('gcode')
        self.reactor = self.printer.get_reactor()
        
        # 从配置读取泵名称列表（可选）
        self.pump_names = config.getlist('pump_names', 
            default=['pump_2', 'pump_3', 'pump_4', 'pump_5'])
        
        # 停止请求标志（用于异步停止）
        self._stop_requested = False
        
        # 注册 G-code 命令
        self.gcode.register_command(
            'ENOSE_ASYNC_STOP',
            self.cmd_async_stop,
            desc="Async stop: immediately stop all pumps (bypasses G-code queue)")
        
        self.gcode.register_command(
            'ENOSE_STATUS',
            self.cmd_status,
            desc="Report E-Nose plugin status")
        
        # 注册 webhook endpoint
        webhooks = self.printer.lookup_object('webhooks')
        webhooks.register_endpoint('enose/async_stop', self._handle_async_stop_webhook)
        webhooks.register_endpoint('enose/status', self._handle_status_webhook)
        
        logging.info("EnoseControl: Plugin v2.0 loaded, pumps: %s", self.pump_names)
        logging.info("EnoseControl: Commands: ENOSE_ASYNC_STOP, ENOSE_STATUS")
    
    def cmd_status(self, gcmd):
        """报告插件状态"""
        # 检查每个泵的状态
        status_lines = ["E-Nose Control Plugin v2.0"]
        status_lines.append("Configured pumps: %s" % ', '.join(self.pump_names))
        
        toolhead = self.printer.lookup_object('toolhead')
        for pump_name in self.pump_names:
            try:
                stepper = self.printer.lookup_object('manual_stepper ' + pump_name)
                axis_id = getattr(stepper, 'axis_gcode_id', None)
                if axis_id:
                    status_lines.append("  %s: registered as axis %s" % (pump_name, axis_id))
                else:
                    status_lines.append("  %s: not registered" % pump_name)
            except:
                status_lines.append("  %s: not found" % pump_name)
        
        status_lines.append("Commands: ENOSE_ASYNC_STOP, ENOSE_STATUS")
        status_lines.append("Webhooks: enose/async_stop, enose/status")
        gcmd.respond_info('\n'.join(status_lines))
    
    # ========== 异步停止 (使用 reactor 回调绕过 G-code 队列) ==========
    
    def cmd_async_stop(self, gcmd):
        """异步停止：使用 reactor 回调立即执行停止操作"""
        # 设置停止标志
        self._stop_requested = True
        
        # 使用 reactor.register_async_callback() 立即调度停止操作
        # 这与 M112 急停使用相同的机制
        self.reactor.register_async_callback(self._async_stop_callback)
        
        gcmd.respond_info("ENOSE_ASYNC_STOP: Stop scheduled via reactor callback")
        logging.info("EnoseControl: ASYNC_STOP scheduled")
    
    def _async_stop_callback(self, eventtime):
        """reactor 回调：立即执行停止操作
        
        关键发现：flush_step_generation() 实际上会生成并发送所有剩余步进到 MCU！
        正确的停止方法是：
        1. 不调用 flush_step_generation()
        2. 重置 need_step_gen_time 阻止后续步进生成
        3. wipe_trapq 清除待处理移动
        4. 禁用电机
        """
        logging.info("EnoseControl: _async_stop_callback executing at eventtime=%.3f", eventtime)
        
        try:
            toolhead = self.printer.lookup_object('toolhead')
            motion_queuing = self.printer.lookup_object('motion_queuing')
            mcu = self.printer.lookup_object('mcu')
            
            # 获取当前估计打印时间
            est_print_time = mcu.estimated_print_time(eventtime)
            
            # 【关键修复】重置时间变量，但不能回到过去
            # MCU 已经接收了到 last_step_gen_time 的命令，不能重置到更早的时间
            old_need_sg_time = motion_queuing.need_step_gen_time
            old_last_sg_time = motion_queuing.last_step_gen_time
            
            # reset_time 必须 >= last_step_gen_time，否则会与已调度的 MCU 定时器冲突
            # 加一点缓冲时间（0.1秒）确保安全
            SAFETY_BUFFER = 0.1
            reset_time = max(est_print_time, old_last_sg_time) + SAFETY_BUFFER
            
            # 只重置 need_* 变量来阻止新步进生成
            # 不修改 last_* 变量，因为那些代表已发送到 MCU 的命令
            motion_queuing.need_step_gen_time = reset_time
            motion_queuing.need_flush_time = reset_time
            # 注意：不再重置 last_step_gen_time 和 last_flush_time
            
            logging.info("EnoseControl: Reset timing - need_sg: %.3f->%.3f, last_sg: %.3f (kept), blocked %.3fs future steps", 
                old_need_sg_time, reset_time, old_last_sg_time,
                old_need_sg_time - reset_time)
            
            # 重置 toolhead 的 print_time 到安全时间
            toolhead.print_time = reset_time
            
            # 清空 lookahead 队列（不调用 flush_all_steps）
            toolhead.lookahead.reset()
            toolhead.special_queuing_state = "NeedPrime"
            
            # 停止每个泵
            for pump_name in self.pump_names:
                try:
                    stepper = self.printer.lookup_object('manual_stepper ' + pump_name)
                    
                    # 清空该泵的 trapq
                    if hasattr(stepper, 'trapq') and stepper.trapq is not None:
                        motion_queuing.wipe_trapq(stepper.trapq)
                        logging.info("EnoseControl: Wiped trapq for %s", pump_name)
                    
                    # 取消 GCODE_AXIS 注册
                    if hasattr(stepper, 'axis_gcode_id') and stepper.axis_gcode_id is not None:
                        toolhead.remove_extra_axis(stepper)
                        stepper.axis_gcode_id = None
                        logging.info("EnoseControl: Unregistered %s from GCODE_AXIS", pump_name)
                    
                    # 禁用电机
                    stepper.do_enable(False)
                    
                    # 【重要】重置坐标为 0，确保下次进样使用相对位移语义
                    stepper.commanded_pos = 0.
                    stepper.rail.set_position([0., 0., 0.])
                    logging.info("EnoseControl: Reset %s position to 0", pump_name)
                    
                except Exception as e:
                    logging.warning("EnoseControl: Async stop error for %s: %s", pump_name, str(e))
            
            self._stop_requested = False
            logging.info("EnoseControl: _async_stop_callback completed, ~%.1fs of motion may still execute", 
                0.7)  # BGFLUSH_SG_HIGH_TIME
            
        except Exception as e:
            logging.exception("EnoseControl: _async_stop_callback error: %s", str(e))
    
    # ========== Webhook handlers ==========
    
    def _handle_async_stop_webhook(self, web_request):
        """Webhook: 异步停止 (通过 reactor 回调)"""
        try:
            self._stop_requested = True
            self.reactor.register_async_callback(self._async_stop_callback)
            web_request.send({'status': 'scheduled', 'message': 'Stop scheduled via reactor'})
            logging.info("EnoseControl: Webhook async_stop scheduled")
        except Exception as e:
            logging.exception("EnoseControl: Webhook async_stop error")
            raise self.printer.command_error("async_stop failed: %s" % str(e))
    
    def _handle_status_webhook(self, web_request):
        """Webhook: 获取状态"""
        status = {
            'plugin_version': '2.0',
            'pumps': {}
        }
        for pump_name in self.pump_names:
            try:
                stepper = self.printer.lookup_object('manual_stepper ' + pump_name)
                axis_id = getattr(stepper, 'axis_gcode_id', None)
                status['pumps'][pump_name] = {
                    'registered': axis_id is not None,
                    'axis': axis_id
                }
            except:
                status['pumps'][pump_name] = {'error': 'not found'}
        web_request.send(status)

def load_config(config):
    return EnoseControl(config)

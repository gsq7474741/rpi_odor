# E-Nose Klipper Plugin
# 提供原生 Klipper 不支持的扩展功能
#
# 功能列表:
# - ENOSE_FAST_STOP: 急停，清空队列并禁用电机（无需 FIRMWARE_RESTART）
# - ENOSE_PUMP_STOP: 仅停止泵电机（保留其他轴）
# - ENOSE_ASYNC_STOP: 使用 reactor 异步回调立即停止（绕过 G-code 队列）
#
# 用法: 在 printer.cfg 中添加 [enose_control]
#
# 关键机制:
# - ENOSE_ASYNC_STOP 使用 reactor.register_async_callback() 立即执行
# - 这与 M112 急停使用相同的机制，能真正绕过 G-code 队列

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
            'ENOSE_FAST_STOP', 
            self.cmd_fast_stop,
            desc="Emergency stop: flush queue and disable all motors")
        
        self.gcode.register_command(
            'ENOSE_PUMP_STOP',
            self.cmd_pump_stop,
            desc="Stop only pump motors (preserve other axes)")
        
        self.gcode.register_command(
            'ENOSE_STATUS',
            self.cmd_status,
            desc="Report E-Nose plugin status")
        
        # 【关键】异步停止命令 - 使用 reactor 回调立即执行
        self.gcode.register_command(
            'ENOSE_ASYNC_STOP',
            self.cmd_async_stop,
            desc="Async stop: immediately schedule stop via reactor (bypasses G-code queue)")
        
        # 注册 webhook endpoint
        webhooks = self.printer.lookup_object('webhooks')
        webhooks.register_endpoint('enose/pump_stop', self._handle_pump_stop_webhook)
        webhooks.register_endpoint('enose/fast_stop', self._handle_fast_stop_webhook)
        webhooks.register_endpoint('enose/status', self._handle_status_webhook)
        
        logging.info("EnoseControl: Plugin loaded, pumps: %s", self.pump_names)
        logging.info("EnoseControl: Commands: ENOSE_FAST_STOP, ENOSE_PUMP_STOP, ENOSE_ASYNC_STOP, ENOSE_STATUS")
    
    def cmd_fast_stop(self, gcmd):
        """急停命令：清空步进队列 + 禁用所有电机"""
        try:
            # 1. 获取 toolhead
            toolhead = self.printer.lookup_object('toolhead')
            
            # 2. 清空步进生成队列
            toolhead.flush_step_generation()
            
            # 3. 获取电机使能控制器并关闭所有电机
            stepper_enable = self.printer.lookup_object('stepper_enable')
            stepper_enable.motor_off()
            
            gcmd.respond_info(
                "ENOSE_FAST_STOP: Queue flushed, all motors disabled. "
                "Position lost - re-register GCODE_AXIS before next move.")
            logging.info("EnoseControl: FAST_STOP executed")
            
        except Exception as e:
            gcmd.respond_info("ENOSE_FAST_STOP failed: %s" % str(e))
            logging.exception("EnoseControl: FAST_STOP error")
    
    def cmd_pump_stop(self, gcmd):
        """仅停止泵电机（取消 GCODE_AXIS 注册 + 禁用）"""
        stopped = []
        errors = []
        
        try:
            # 1. 获取 toolhead 和 motion_queuing
            toolhead = self.printer.lookup_object('toolhead')
            motion_queuing = self.printer.lookup_object('motion_queuing')
            
            # 2. 清空 Host 端步进生成队列
            toolhead.flush_step_generation()
            
            # 3. 遍历每个泵
            for pump_name in self.pump_names:
                try:
                    stepper = self.printer.lookup_object(
                        'manual_stepper ' + pump_name)
                    
                    # 【关键】清空该泵的 trapq (清除 MCU 端待执行的步进)
                    if hasattr(stepper, 'trapq') and stepper.trapq is not None:
                        motion_queuing.wipe_trapq(stepper.trapq)
                        logging.info("EnoseControl: Wiped trapq for %s", pump_name)
                    
                    # 取消 GCODE_AXIS 注册 (直接操作内部状态)
                    if hasattr(stepper, 'axis_gcode_id') and stepper.axis_gcode_id is not None:
                        toolhead.remove_extra_axis(stepper)
                        stepper.axis_gcode_id = None
                        logging.info("EnoseControl: Unregistered %s from GCODE_AXIS", pump_name)
                    
                    # 禁用电机
                    stepper.do_enable(False)
                    stopped.append(pump_name)
                    
                except Exception as e:
                    err_msg = "%s: %s" % (pump_name, str(e))
                    errors.append(err_msg)
                    logging.warning("EnoseControl: Could not stop %s: %s", pump_name, str(e))
            
            # 构建响应消息
            msg = "ENOSE_PUMP_STOP: "
            if stopped:
                msg += "Stopped: %s. " % ', '.join(stopped)
            if errors:
                msg += "Errors: %s. " % '; '.join(errors)
            msg += "Re-register GCODE_AXIS before next move."
            
            gcmd.respond_info(msg)
            logging.info("EnoseControl: PUMP_STOP executed - stopped: %s, errors: %s", 
                stopped, errors)
            
        except Exception as e:
            gcmd.respond_info("ENOSE_PUMP_STOP failed: %s" % str(e))
            logging.exception("EnoseControl: PUMP_STOP error")
    
    def cmd_status(self, gcmd):
        """报告插件状态"""
        # 检查每个泵的状态
        status_lines = ["E-Nose Control Plugin v1.1"]
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
        
        status_lines.append("Commands: ENOSE_FAST_STOP, ENOSE_PUMP_STOP, ENOSE_ASYNC_STOP, ENOSE_STATUS")
        status_lines.append("Webhooks: enose/pump_stop, enose/fast_stop, enose/status")
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
            
            # 【关键修复】重置 need_step_gen_time 为当前时间
            # 这会阻止 _flush_handler 继续生成后续步进
            # 注意：已经生成的步进（约 0.7 秒内的）仍会执行
            old_need_sg_time = motion_queuing.need_step_gen_time
            motion_queuing.need_step_gen_time = est_print_time
            motion_queuing.need_flush_time = est_print_time
            logging.info("EnoseControl: Reset need_step_gen_time from %.3f to %.3f (diff=%.3fs)", 
                old_need_sg_time, est_print_time, old_need_sg_time - est_print_time)
            
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
                    
                except Exception as e:
                    logging.warning("EnoseControl: Async stop error for %s: %s", pump_name, str(e))
            
            self._stop_requested = False
            logging.info("EnoseControl: _async_stop_callback completed, ~%.1fs of motion may still execute", 
                0.7)  # BGFLUSH_SG_HIGH_TIME
            
        except Exception as e:
            logging.exception("EnoseControl: _async_stop_callback error: %s", str(e))
    
    # ========== Webhook handlers (绕过 G-code 队列，立即执行) ==========
    
    def _do_pump_stop(self):
        """内部方法：执行泵停止逻辑"""
        stopped = []
        errors = []
        
        toolhead = self.printer.lookup_object('toolhead')
        motion_queuing = self.printer.lookup_object('motion_queuing')
        
        # 清空 Host 端步进生成队列
        toolhead.flush_step_generation()
        
        for pump_name in self.pump_names:
            try:
                stepper = self.printer.lookup_object('manual_stepper ' + pump_name)
                
                # 清空该泵的 trapq
                if hasattr(stepper, 'trapq') and stepper.trapq is not None:
                    motion_queuing.wipe_trapq(stepper.trapq)
                
                # 取消 GCODE_AXIS 注册
                if hasattr(stepper, 'axis_gcode_id') and stepper.axis_gcode_id is not None:
                    toolhead.remove_extra_axis(stepper)
                    stepper.axis_gcode_id = None
                
                # 禁用电机
                stepper.do_enable(False)
                stopped.append(pump_name)
                
            except Exception as e:
                errors.append("%s: %s" % (pump_name, str(e)))
        
        logging.info("EnoseControl: Webhook PUMP_STOP - stopped: %s, errors: %s", stopped, errors)
        return {'stopped': stopped, 'errors': errors}
    
    def _do_fast_stop(self):
        """内部方法：执行急停逻辑"""
        toolhead = self.printer.lookup_object('toolhead')
        toolhead.flush_step_generation()
        
        stepper_enable = self.printer.lookup_object('stepper_enable')
        stepper_enable.motor_off()
        
        logging.info("EnoseControl: Webhook FAST_STOP executed")
        return {'status': 'stopped', 'message': 'All motors disabled'}
    
    def _handle_pump_stop_webhook(self, web_request):
        """Webhook: 泵停止 (绕过 G-code 队列)"""
        try:
            result = self._do_pump_stop()
            web_request.send(result)
        except Exception as e:
            logging.exception("EnoseControl: Webhook pump_stop error")
            raise self.printer.command_error("pump_stop failed: %s" % str(e))
    
    def _handle_fast_stop_webhook(self, web_request):
        """Webhook: 急停 (绕过 G-code 队列)"""
        try:
            result = self._do_fast_stop()
            web_request.send(result)
        except Exception as e:
            logging.exception("EnoseControl: Webhook fast_stop error")
            raise self.printer.command_error("fast_stop failed: %s" % str(e))
    
    def _handle_status_webhook(self, web_request):
        """Webhook: 获取状态"""
        status = {
            'plugin_version': '1.2',
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

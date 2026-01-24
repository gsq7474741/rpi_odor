# rpi_odor



## tips

### docker 镜像

1. 编辑 docker 配置文件

```bash
sudo vim /etc/docker/daemon.json
```

```json
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.1ms.run",
    "https://dytt.online",
    "https://docker-0.unsee.tech",
    "https://lispy.org",
    "https://docker.xiaogenban1993.com",
    "https://666860.xyz",
    "https://hub.rat.dev",
    "https://docker.m.daocloud.io",
    "https://mirror.ccs.tencentyun.com",
    "https://<your_code>.mirror.aliyuncs.com"
  ]
}
```

2. 重新加载 docker 配置并重启

```bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

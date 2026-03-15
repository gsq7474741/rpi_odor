# rpi_odor

## 实际重量校准

run 1:
24.7g mesure = 30.7g gt
58.9g mesure = 62.7g gt
57.4g mesure = 62.5g gt
80.6g mesure = 100.0g gt
98g mesure = 126g gt
123.3g mesure = 150.4g gt

run 2:
80g set = 101.5g gt
60g set = 83.3g gt
40g set = 50.7g gt

run 3:
30g set = 40.3g gt
40g set = 47.1g gt


mesure_weight = mm * 0.0314 - 7.34
pump_mm_to_ml = 0.0314
pump_mm_offset = -7.34

gt = 1.2865 * mesure_weight - 6.2513

gt = 1.27 * set_weight_g + 2.3
weight_scale = 1.27
weight_offset = 2.3

internal_weight = (set_weight_g - weight_offset) / weight_scale
mm = internal_weight / pump_mm_to_ml


mm = internal_weight * pump_mm_to_ml + pump_mm_offset
gt = k1 
y1 = k1 * x1 + b1
y2 = k2 * y1 + b2
y2 = k2 * (k1 * x1 + b1) + b2 = k2 * k1 * x1 + k2 * b1 + b2 = k3 * x1 + b3


k1 = 1.2865
b1 = -6.2513
k2 = 1.27
b2 = 2.3
k3 = k2 * k1 = 1.635205
b3 = k2 * b1 + b2 = -5.903611


pump 1
100mm = 3.7g gt
200mm = 7.6g gt
300mm = 11.5g gt
400mm = 15.1g gt
1000mm = 37.4g gt
2000mm = 74.6g gt

pump 2
100mm = 3.8g gt
400mm = 14.3g gt
1000mm = 34.3g gt
2000mm = 74.6g gt




## tips

### 查看代码统计和复杂度

```bash
scoop install scc
scc --exclude-dir dist,build .
```

截止2602081823，代码行数：

```bash
➜  rpi_odor git:(master) scc --exclude-dir dist,build .
───────────────────────────────────────────────────────────────────────────────
Language            Files       Lines    Blanks  Comments       Code Complexity
───────────────────────────────────────────────────────────────────────────────
TypeScript            202      47,190     4,081     2,101     41,008      5,251
Python                 54      13,371     1,817     1,292     10,262      1,874
C++                    41      16,244     2,656     1,118     12,470      2,210
C++ Header             35       4,931       843       974      3,114         83
Markdown               29       8,044     1,675         0      6,369          0
YAML                   27       4,659       120       130      4,409          0
SQL                    16       2,663       334       576      1,753          4
C Header               11         865       128       388        349          3
Powershell              9       1,202       177       224        801        181
JSON                    7         478         0         0        478          0
Protocol Buffe…         6       3,952       714       755      2,483          0
SVG                     5           5         0         0          5          0
Shell                   3         123        18        10         95         14
CSS                     2         239        12        79        148          0
JavaScript              2          25         3         2         20          0
TOML                    2          89        13         0         76          0
CMake                   1          71        13        10         48          0
CSV                     1           5         0         0          5          0
Dockerfile              1          36        10        11         15          2
INI                     1          44         5        26         13          0
Plain Text              1          13         1         0         12          0
Systemd                 1          23         3         1         19          0
───────────────────────────────────────────────────────────────────────────────
Total                 457     104,272    12,623     7,697     83,952      9,622
───────────────────────────────────────────────────────────────────────────────
Estimated Cost to Develop (organic) $2,830,270
Estimated Schedule Effort (organic) 20.42 months
Estimated People Required (organic) 12.31
───────────────────────────────────────────────────────────────────────────────
Processed 3611392 bytes, 3.611 megabytes (SI)
───────────────────────────────────────────────────────────────────────────────
```


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



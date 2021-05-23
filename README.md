# webar-vue-demo

一个基于 w3c webxr 的 webar 展示 demo，使用工具 vue/vite

## 使用方法

```bash
# 克隆项目
git clone https://github.com/MleMoe/webar-vue-demo.git

# 安装依赖
yarn

# 运行
yarn start
```

## 测试设备

设备要求：支持 AR Core 的安卓手机，Chrome 浏览器（版本 81 以上）
手机和 PC 在同一局域网下
在地址栏输入 chrome://flags，搜索 webxr，找到 WebXR incubations，设置为启用状态
搜索 Insecure origins treated as secure，设置成 Enabled 状态，并在其上的文本框内输入 `http://your-ipv4-address:3000/`，relaunch 一下 chrome，就能使用该测试链接查看 AR 内容了。

## demo 展示

https://mlemoe.github.io/webar-vue-demo/

#!/bin/bash

# setup-ec2.sh - EC2 环境初始化脚本
# 在新的 EC2 实例上运行此脚本来安装所有必要的软件

set -e

echo "🔧 开始设置 EC2 环境..."

# 更新系统
echo "📦 更新系统包..."
sudo yum update -y

# 安装基础工具
echo "🛠️  安装基础工具..."
sudo yum install -y git wget curl unzip

# 安装 Node.js 18
echo "📦 安装 Node.js 18..."
curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
sudo yum install -y nodejs

# 安装 Yarn
echo "📦 安装 Yarn..."
npm install -g yarn

# 安装 PM2
echo "📦 安装 PM2..."
npm install -g pm2

# 安装 FFmpeg
echo "🎵 安装 FFmpeg..."
sudo yum install -y epel-release
sudo yum install -y ffmpeg

# 安装构建工具 (某些 npm 包需要)
echo "🔨 安装构建工具..."
sudo yum groupinstall -y "Development Tools"
sudo yum install -y python3 python3-pip

# 配置防火墙 (如果使用)
echo "🔥 配置防火墙..."
sudo firewall-cmd --permanent --add-port=8002/tcp || true
sudo firewall-cmd --reload || true

# 创建应用目录和日志目录
echo "📁 创建目录..."
mkdir -p /home/ec2-user/english-learning-app
mkdir -p /home/ec2-user/logs
mkdir -p /home/ec2-user/backups

# 设置目录权限
sudo chown -R ec2-user:ec2-user /home/ec2-user/

# 显示安装的版本
echo "✅ 环境设置完成！"
echo ""
echo "📋 已安装的软件版本："
echo "Node.js: $(node -v)"
echo "NPM: $(npm -v)"
echo "Yarn: $(yarn -v)"
echo "PM2: $(pm2 -v)"
echo "FFmpeg: $(ffmpeg -version | head -n1)"
echo "Git: $(git --version)"
echo ""
echo "🎯 下一步："
echo "1. 设置AWS凭证: aws configure"
echo "2. 克隆你的代码仓库"
echo "3. 运行部署脚本: ./deploy.sh"

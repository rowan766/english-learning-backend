#!/bin/bash

# deploy.sh - EC2 部署脚本

set -e

# 配置变量
APP_NAME="english-learning-api"
APP_DIR="/home/ec2-user/english-learning-app"
REPO_URL="https://github.com/rowan766/english-learning-backend/tree/dev"  # 替换为你的Git仓库
BACKUP_DIR="/home/ec2-user/backups"

echo "🚀 开始部署 English Learning API..."

# 创建必要的目录
sudo mkdir -p /home/ec2-user/logs
sudo mkdir -p $BACKUP_DIR
sudo mkdir -p $APP_DIR/public/audio
sudo mkdir -p $APP_DIR/temp

# 如果是首次部署，克隆代码
if [ ! -d "$APP_DIR" ]; then
    echo "📦 首次部署，克隆代码仓库..."
    git clone $REPO_URL $APP_DIR
    cd $APP_DIR
else
    echo "🔄 更新代码..."
    cd $APP_DIR
    
    # 备份当前版本
    if [ -d "dist" ]; then
        sudo cp -r dist $BACKUP_DIR/dist-$(date +%Y%m%d_%H%M%S)
    fi
    
    # 拉取最新代码
    git pull origin main
fi

echo "📋 安装/更新依赖..."
yarn install --frozen-lockfile

echo "🔨 构建应用..."
yarn build

echo "⚙️  配置 PM2..."
# 如果应用正在运行，先停止
if pm2 list | grep -q $APP_NAME; then
    echo "🛑 停止旧版本..."
    pm2 stop $APP_NAME
    pm2 delete $APP_NAME
fi

# 启动新版本
echo "🚀 启动应用..."
pm2 start ecosystem.config.js

# 保存PM2配置
pm2 save

# 设置开机自启
pm2 startup

echo "✅ 部署完成！"
echo "📊 应用状态："
pm2 status
echo ""
echo "🌐 应用访问地址："
echo "http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8002"
echo "API文档: http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4):8002/api"
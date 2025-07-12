// 嵌入式PairDrop服务器 - 在Electron主进程中运行
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { UAParser } = require('ua-parser-js');
const { uniqueNamesGenerator, adjectives, colors, animals } = require('unique-names-generator');

let server;
let wsServer;

// 兼容的哈希函数
const hasher = (() => {
    let password;
    return {
        hashCodeSalted(salt) {
            if (!password) {
                password = crypto.randomBytes(64).toString('hex');
            }
            return crypto.createHash("sha256")
                .update(password)
                .update(crypto.createHash("sha256").update(salt, "utf8").digest("hex"))
                .digest("hex");
        }
    }
})();

// 随机字符串生成器
const randomizer = {
    getRandomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
};

// IP处理函数
function getClientIP(req) {
    let clientIP = req.headers['x-forwarded-for'] || 
                   req.headers['cf-connecting-ip'] || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress;
    
    if (clientIP && clientIP.includes(',')) {
        clientIP = clientIP.split(',')[0].trim();
    }
    
    // 处理IPv6回环地址
    if (clientIP === '::1' || clientIP === '::ffff:127.0.0.1') {
        clientIP = '127.0.0.1';
    }
    
    return clientIP;
}

// 设备名称生成
function getDeviceName(userAgent, isLegacy) {
    const ua = UAParser(userAgent);
    let deviceName = '';
    
    if (ua.os && ua.os.name) {
        deviceName += ua.os.name;
    }
    
    if (ua.browser && ua.browser.name) {
        deviceName += ' ' + ua.browser.name;
    }
    
    if (!deviceName) {
        deviceName = 'Unknown Device';
    }
    
    return deviceName;
}

// Peer管理
class Peers {
    constructor() {
        this.peers = new Map();
    }
    
    add(peer) {
        this.peers.set(peer.id, peer);
    }
    
    get(id) {
        return this.peers.get(id);
    }
    
    delete(id) {
        return this.peers.delete(id);
    }
    
    getAll() {
        return Array.from(this.peers.values());
    }
    
    getByIP(ip) {
        return this.getAll().filter(peer => peer.ip === ip);
    }
}

const peers = new Peers();

// 启动嵌入式服务器
function startEmbeddedServer(port, isDev, resourcePath) {
    return new Promise((resolve, reject) => {
        try {
            const app = express();
            
            // 静态文件服务
            const publicPath = isDev 
                ? path.join(__dirname, '../public')
                : path.join(resourcePath, 'app/public');
            
            app.use(express.static(publicPath));
            
            // 配置端点
            app.get('/config', (req, res) => {
                res.json({
                    rtcConfig: {
                        "sdpSemantics": "unified-plan",
                        "iceServers": [
                            {
                                "urls": "stun:stun.l.google.com:19302"
                            }
                        ]
                    },
                    signalingServer: false,
                    wsFallback: false,
                    isElectron: true
                });
            });
            
            // IP调试端点
            if (isDev) {
                app.get('/ip', (req, res) => {
                    res.send(getClientIP(req));
                });
            }
            
            server = http.createServer(app);
            
            // WebSocket服务器
            wsServer = new WebSocket.Server({ server });
            
            wsServer.on('connection', (ws, req) => {
                const ip = getClientIP(req);
                const id = hasher.hashCodeSalted(ip);
                const deviceName = getDeviceName(req.headers['user-agent']);
                
                const peer = {
                    id: id,
                    ws: ws,
                    ip: ip,
                    name: deviceName,
                    rtcSupported: true
                };
                
                peers.add(peer);
                
                if (isDev) {
                    console.log('New peer connected:', id, 'IP:', ip);
                }
                
                // 发送欢迎消息
                ws.send(JSON.stringify({
                    type: 'display-name',
                    message: {
                        displayName: deviceName,
                        deviceName: deviceName
                    }
                }));
                
                // 广播新peer给其他peers
                const peerInfo = {
                    id: id,
                    name: deviceName,
                    rtcSupported: true
                };
                
                peers.getAll().forEach(otherPeer => {
                    if (otherPeer.id !== id && otherPeer.ws.readyState === WebSocket.OPEN) {
                        otherPeer.ws.send(JSON.stringify({
                            type: 'peer-joined',
                            peer: peerInfo
                        }));
                    }
                });
                
                // 发送现有peers列表
                const existingPeers = peers.getAll()
                    .filter(p => p.id !== id)
                    .map(p => ({
                        id: p.id,
                        name: p.name,
                        rtcSupported: p.rtcSupported
                    }));
                
                if (existingPeers.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'peers',
                        peers: existingPeers
                    }));
                }
                
                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        const targetPeer = peers.get(data.to);
                        
                        if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                            targetPeer.ws.send(JSON.stringify({
                                ...data,
                                from: id
                            }));
                        }
                    } catch (error) {
                        console.error('Error handling message:', error);
                    }
                });
                
                ws.on('close', () => {
                    peers.delete(id);
                    
                    // 通知其他peers
                    peers.getAll().forEach(otherPeer => {
                        if (otherPeer.ws.readyState === WebSocket.OPEN) {
                            otherPeer.ws.send(JSON.stringify({
                                type: 'peer-left',
                                peerId: id
                            }));
                        }
                    });
                    
                    if (isDev) {
                        console.log('Peer disconnected:', id);
                    }
                });
                
                ws.on('error', (error) => {
                    console.error('WebSocket error:', error);
                    peers.delete(id);
                });
            });
            
            server.listen(port, '0.0.0.0', () => {
                console.log(`PairDrop embedded server running on port ${port}`);
                console.log(`Local access: http://localhost:${port}`);
                
                // 获取本机IP地址
                const os = require('os');
                const networkInterfaces = os.networkInterfaces();
                const localIPs = [];
                
                Object.keys(networkInterfaces).forEach(interfaceName => {
                    const addresses = networkInterfaces[interfaceName];
                    addresses.forEach(address => {
                        if (address.family === 'IPv4' && !address.internal) {
                            localIPs.push(address.address);
                        }
                    });
                });
                
                if (localIPs.length > 0) {
                    console.log('LAN access from other devices:');
                    localIPs.forEach(ip => {
                        console.log(`  http://${ip}:${port}`);
                    });
                } else {
                    console.log('No external network interfaces found');
                }
                
                resolve();
            });
            
            server.on('error', (error) => {
                console.error('Server error:', error);
                reject(error);
            });
            
        } catch (error) {
            reject(error);
        }
    });
}

function stopEmbeddedServer() {
    if (wsServer) {
        wsServer.close();
        wsServer = null;
    }
    
    if (server) {
        server.close();
        server = null;
    }
    
    peers.peers.clear();
}

module.exports = {
    startEmbeddedServer,
    stopEmbeddedServer
};
// 嵌入式PairDrop服务器 - 在Electron主进程中运行
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const { UAParser } = require('ua-parser-js');
const { uniqueNamesGenerator, colors, animals } = require('unique-names-generator');

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

// IP处理函数 - 实现IP正规化以支持跨设备发现
function getClientIP(req) {
    let clientIP;
    
    // 按优先级获取IP
    if (req.headers['cf-connecting-ip']) {
        clientIP = req.headers['cf-connecting-ip'].split(/\s*,\s*/)[0];
    }
    else if (req.headers['x-forwarded-for']) {
        clientIP = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
    }
    else {
        clientIP = req.socket.remoteAddress || req.connection.remoteAddress || '';
    }
    
    // 移除IPv4映射地址的前缀
    if (clientIP.substring(0, 7) === "::ffff:") {
        clientIP = clientIP.substring(7);
    }
    
    const originalIP = clientIP;
    
    // 关键逻辑：将私有IP和回环地址统一到127.0.0.1，这样局域网设备可以互相发现
    if (clientIP === '::1' || isPrivateIP(clientIP)) {
        clientIP = '127.0.0.1';
    }
    
    console.log('🌐 Client IP normalization:');
    console.log('  - Original IP:', originalIP);
    console.log('  - Is Private IP:', isPrivateIP(originalIP));
    console.log('  - Final IP (normalized):', clientIP);
    
    return clientIP;
}

// 检查是否为私有IP地址
function isPrivateIP(ip) {
    // 如果是IPv4
    if (!ip.includes(":")) {
        // 10.0.0.0 - 10.255.255.255 || 172.16.0.0 - 172.31.255.255 || 192.168.0.0 - 192.168.255.255
        return /^(10)\.(.*)\.(.*)\.(.*)$/.test(ip) || 
               /^(172)\.(1[6-9]|2[0-9]|3[0-1])\.(.*)\.(.*)$/.test(ip) || 
               /^(192)\.(168)\.(.*)\.(.*)$/.test(ip);
    }
    
    // IPv6地址的私有地址检查
    const firstWord = ip.split(":").find(el => !!el);
    if (!firstWord) return false;
    
    // IPv6 Site Local addresses (已弃用): fec0 - feff
    if (/^fe[c-f][0-f]$/.test(firstWord)) {
        return true;
    }
    
    // Unique Local Addresses (ULA): fc00 - fdff
    if (/^f[cd][0-f]{2}$/.test(firstWord)) {
        return true;
    }
    
    // Link local addresses: fe80
    if (firstWord === "fe80") {
        return true;
    }
    
    return false;
}

// 设备名称生成 - 匹配原版服务器逻辑
function getDeviceName(userAgent) {
    const ua = UAParser(userAgent);
    
    let deviceName = '';
    
    if (ua.os && ua.os.name) {
        deviceName = ua.os.name.replace('Mac OS', 'Mac') + ' ';
    }
    
    if (ua.device && ua.device.model) {
        deviceName += ua.device.model;
    } else if (ua.browser && ua.browser.name) {
        deviceName += ua.browser.name;
    }
    
    if (!deviceName) {
        deviceName = 'Unknown Device';
    }
    
    return deviceName;
}

// 生成显示名称（彩色动物名）
function getDisplayName(peerId) {
    // 使用相同的随机种子逻辑
    const seed = cyrb53(peerId);
    return uniqueNamesGenerator({
        length: 2,
        separator: ' ',
        dictionaries: [colors, animals], // 使用colors和animals，就像原版服务器一样
        style: 'capital',
        seed: seed
    });
}

// 简单哈希函数（cyrb53的简化版本）
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
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
function startEmbeddedServer(port, isDev) {
    return new Promise((resolve, reject) => {
        try {
            const app = express();
            
            // 静态文件服务
            const publicPath = isDev 
                ? path.join(__dirname, '../public')
                : path.join(__dirname, '../public');
            
            console.log('Static files path:', publicPath);
            console.log('Path exists:', require('fs').existsSync(publicPath));
            
            app.use(express.static(publicPath));
            
            // 添加根路径处理
            app.get('/', (req, res) => {
                const indexPath = path.join(publicPath, 'index.html');
                console.log('Serving index.html from:', indexPath);
                res.sendFile(indexPath);
            });
            
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
                // 为每个连接生成唯一的UUID，就像原版服务器一样
                const id = crypto.randomUUID();
                const deviceName = getDeviceName(req.headers['user-agent']);
                const displayName = getDisplayName(id);
                
                console.log('🔌 NEW WEBSOCKET CONNECTION');
                console.log('  - IP:', ip);
                console.log('  - ID:', id.substring(0, 8) + '...');
                console.log('  - Device Name:', deviceName);
                console.log('  - Display Name:', displayName);
                console.log('  - Total peers before:', peers.getAll().length);
                
                const peer = {
                    id: id,
                    ws: ws,
                    ip: ip,
                    name: {
                        deviceName: deviceName,
                        displayName: displayName
                    },
                    rtcSupported: true
                };
                
                peers.add(peer);
                console.log('  - Total peers after:', peers.getAll().length);
                
                // 发送配置信息
                ws.send(JSON.stringify({
                    type: 'ws-config',
                    wsConfig: {
                        rtcConfig: {
                            "sdpSemantics": "unified-plan",
                            "iceServers": [
                                {
                                    "urls": "stun:stun.l.google.com:19302"
                                }
                            ]
                        },
                        wsFallback: false
                    }
                }));
                
                // 发送显示名称 - 格式必须与原版服务器完全一致
                const displayNameMsg = {
                    type: 'display-name',
                    displayName: displayName,
                    deviceName: deviceName,
                    peerId: id,
                    peerIdHash: hasher.hashCodeSalted(id)
                };
                console.log('📤 Sending display-name:', displayNameMsg);
                ws.send(JSON.stringify(displayNameMsg));
                
                // 注意：不在连接时立即广播peers，等待客户端发送join-ip-room消息
                
                ws.on('message', (message) => {
                    try {
                        const data = JSON.parse(message);
                        console.log('📨 Received message:', data.type, 'from peer:', id.substring(0, 8));
                        
                        // 处理join-ip-room消息 - 这是设备发现的关键！
                        if (data.type === 'join-ip-room') {
                            console.log('🏠 Processing join-ip-room for peer:', id.substring(0, 8) + '...', 'IP:', ip);
                            
                            // 获取同IP段的所有peers
                            const allPeersOfSameIP = peers.getByIP(ip);
                            const samePeers = allPeersOfSameIP.filter(p => p.id !== id);
                            
                            console.log('👥 All peers with IP', ip + ':', allPeersOfSameIP.length);
                            console.log('👥 Other peers (excluding current):', samePeers.length);
                            allPeersOfSameIP.forEach(p => {
                                console.log('   - Peer:', p.id.substring(0, 8) + '...', 'Name:', p.name.displayName);
                            });
                            
                            // 通知当前peer其他同IP段设备
                            if (samePeers.length > 0) {
                                console.log('📤 Sending peers list to current peer');
                                ws.send(JSON.stringify({
                                    type: 'peers',
                                    peers: samePeers.map(p => ({
                                        id: p.id,
                                        name: p.name, // 这已经是包含deviceName和displayName的对象
                                        rtcSupported: p.rtcSupported
                                    })),
                                    roomType: 'ip',
                                    roomId: ip
                                }));
                            }
                            
                            // 通知其他同IP段peers有新设备加入
                            samePeers.forEach(otherPeer => {
                                if (otherPeer.ws.readyState === WebSocket.OPEN) {
                                    otherPeer.ws.send(JSON.stringify({
                                        type: 'peer-joined',
                                        peer: {
                                            id: id,
                                            name: {
                                                deviceName: deviceName,
                                                displayName: displayName
                                            },
                                            rtcSupported: true
                                        },
                                        roomType: 'ip', 
                                        roomId: ip
                                    }));
                                }
                            });
                            return;
                        }
                        
                        // 处理其他消息 - 转发给目标peer
                        const targetPeer = peers.get(data.to);
                        
                        if (targetPeer && targetPeer.ws.readyState === WebSocket.OPEN) {
                            targetPeer.ws.send(JSON.stringify({
                                ...data,
                                sender: {
                                    id: id,
                                    rtcSupported: true
                                }
                            }));
                        }
                    } catch (error) {
                        console.error('Error handling message:', error);
                    }
                });
                
                ws.on('close', () => {
                    console.log('❌ PEER DISCONNECTED:', id.substring(0, 8) + '...', 'IP:', ip);
                    peers.delete(id);
                    
                    // 通知同IP段的其他peers有设备离开
                    const samePeers = peers.getByIP(ip);
                    console.log('📤 Notifying', samePeers.length, 'peers about disconnection');
                    samePeers.forEach(otherPeer => {
                        if (otherPeer.ws.readyState === WebSocket.OPEN) {
                            otherPeer.ws.send(JSON.stringify({
                                type: 'peer-left',
                                peerId: id,
                                roomType: 'ip',
                                roomId: ip,
                                disconnect: true
                            }));
                        }
                    });
                    console.log('  - Total peers remaining:', peers.getAll().length);
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
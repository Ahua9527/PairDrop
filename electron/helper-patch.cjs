// 为Electron环境创建helper.js的补丁版本
// 使用更兼容的哈希算法替代sha3-512

const crypto = require('crypto');

const hasher = (() => {
    let password;
    return {
        hashCodeSalted(salt) {
            if (!password) {
                // password is created on first call.
                password = randomizer.getRandomString(128);
            }

            // 使用sha256替代sha3-512，因为Electron可能不支持sha3
            return crypto.createHash("sha256")
                .update(password)
                .update(crypto.createHash("sha256").update(salt, "utf8").digest("hex"))
                .digest("hex");
        }
    }
})();

const randomizer = (() => {
    return {
        getRandomString(length) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            let result = '';
            for (let i = 0; i < length; i++) {
                result += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            return result;
        }
    }
})();

// 导出兼容格式
module.exports = {
    hasher,
    randomizer
};
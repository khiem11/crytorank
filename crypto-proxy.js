const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { DateTime } = require('luxon');
const colors = require('colors');
const readline = require('readline');

class Cryptorank {
    constructor() {
        const tokenFile = path.join(__dirname, 'token.txt');
        const proxyFile = path.join(__dirname, 'proxy.txt');
        
        this.tokens = fs.readFileSync(tokenFile, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
        this.proxies = fs.readFileSync(proxyFile, 'utf8').replace(/\r/g, '').split('\n').filter(Boolean);
        
        if (this.tokens.length !== this.proxies.length) {
            throw new Error('Số lượng token và proxy phải bằng nhau.');
        }
    }
    
    headers(token) {
        return {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
            "Authorization": token,
            "Content-Type": "application/json",
            "Origin": "https://tma.cryptorank.io",
            "Referer": "https://tma.cryptorank.io/",
            "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        };
    }

    createAxiosInstance(proxy) {
        return axios.create({
            httpsAgent: new HttpsProxyAgent(proxy)
        });
    }

    async getAccount(axiosInstance, token) {
        const url = `https://api.cryptorank.io/v0/tma/account`;
        const headers = this.headers(token);
        return axiosInstance.get(url, { headers });
    }

    async claimFarm(axiosInstance, token) {
        const url = `https://api.cryptorank.io/v0/tma/account/end-farming`;
        const headers = this.headers(token);
        return axiosInstance.post(url, {}, { headers });
    }

    async startFarm(axiosInstance, token) {
        const url = `https://api.cryptorank.io/v0/tma/account/start-farming`;
        const headers = this.headers(token);
        return axiosInstance.post(url, {}, { headers });
    }

    log(msg) {
        console.log(`[*] ${msg}`);
    }

    async checkProxyIP(proxy) {
        try {
            const proxyAgent = new HttpsProxyAgent(proxy);
            const response = await axios.get('https://api.ipify.org?format=json', {
                httpsAgent: proxyAgent
            });
            if (response.status === 200) {
                return response.data.ip;
            } else {
                throw new Error(`Không thể kiểm tra IP của proxy. Status code: ${response.status}`);
            }
        } catch (error) {
            throw new Error(`Error khi kiểm tra IP của proxy: ${error.message}`);
        }
    }

    async waitWithCountdown(seconds) {
        for (let i = seconds; i >= 0; i--) {
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`===== Đã hoàn thành tất cả tài khoản, chờ ${i} giây để tiếp tục vòng lặp =====`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        console.log('');
    }

    async main() {
        let firstFarmCompleteTime = null;
    
        while (true) {
            for (let no = 0; no < this.tokens.length; no++) {
                const token = this.tokens[no];
                const proxy = this.proxies[no];
                const axiosInstance = this.createAxiosInstance(proxy);
    
                try {
                    const proxyIP = await this.checkProxyIP(proxy);
                    console.log(`========== Tài khoản ${no + 1} | IP: ${proxyIP} ==========`);
    
                    const accountResponse = await this.getAccount(axiosInstance, token);
                    const accountData = accountResponse.data;
                    const points = accountData.crPoints;
                    const lastFarming = accountData.lastFarming;
    
                    this.log(`${'Balance:'.green} ${points}`);
                    let claimFarmSuccess = false;
    
                    if (lastFarming === null || lastFarming.type === 'END') {
                        try {
                            await this.startFarm(axiosInstance, token);
                            this.log(`${'Start farm thành công!'.green}`);
                            const updatedAccountResponse = await this.getAccount(axiosInstance, token);
                            const updatedLastFarming = updatedAccountResponse.data.lastFarming;
                            if (no === 0) {
                                firstFarmCompleteTime = DateTime.fromMillis(updatedLastFarming.timestamp).plus({ hours: 6 });
                            }
                        } catch (startError) {
                            this.log(`${'Lỗi khi start farm!'.red}`);
                        }
                    } else if (lastFarming.type === 'START') {
                        const lastFarmingTime = DateTime.fromMillis(lastFarming.timestamp).plus({ hours: 6 });
                        this.log(`${'Thời gian hoàn thành farm:'.green} ${lastFarmingTime.toLocaleString(DateTime.DATETIME_FULL)}`);
                        if (no === 0) {
                            firstFarmCompleteTime = lastFarmingTime;
                        }
                        const now = DateTime.local();
                        if (now > lastFarmingTime) {
                            try {
                                await this.claimFarm(axiosInstance, token);
                                this.log(`${'Claim farm thành công!'.green}`);
                                claimFarmSuccess = true;
                            } catch (claimError) {
                                this.log(`${'Lỗi khi claim farm!'.red}`);
                            }
    
                            try {
                                await this.startFarm(axiosInstance, token);
                                this.log(`${'Start farm lại thành công!'.green}`);
                                const updatedAccountResponse = await this.getAccount(axiosInstance, token);
                                const updatedLastFarming = updatedAccountResponse.data.lastFarming;
                                if (no === 0) {
                                    firstFarmCompleteTime = DateTime.fromMillis(updatedLastFarming.timestamp).plus({ hours: 6 });
                                }
                            } catch (startError) {
                                this.log(`${'Lỗi khi start farm lại!'.red}`);
                            }
                        }
                    }
                } catch (error) {
                    this.log(`${'Lỗi khi xử lý tài khoản'.red}`);
                    console.log(error);
                }
            }
    
            let waitTime;
            if (firstFarmCompleteTime) {
                const now = DateTime.local();
                const diff = firstFarmCompleteTime.diff(now, 'seconds').seconds;
                waitTime = Math.max(0, diff);
            } else {
                waitTime = 15 * 60;
            }
            await this.waitWithCountdown(Math.floor(waitTime));
        }
    }    
}

if (require.main === module) {
    const dancay = new Cryptorank();
    dancay.main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
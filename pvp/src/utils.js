const crypto = require('crypto');
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function seedRandom(seed){ if(seed==null)return; let s=BigInt(seed)&((1n<<48n)-1n); Math.random=function(){ s=(25214903917n*s+11n)&((1n<<48n)-1n); return Number(s)/Number(1n<<48n); }; }
function backoff(attempt, base=300, max=10000){ return Math.min(max, Math.round(base * Math.pow(2, attempt))); }
module.exports={sleep,seedRandom,backoff};

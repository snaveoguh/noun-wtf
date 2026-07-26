import { keccak256, encodeFunctionData, toHex } from 'viem';
const RPC="https://ethereum-rpc.publicnode.com";
const DATA="0xf790a5f59678dd733fb3de93493a91f472ca1365";
const TOKEN="0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03";
const sel=s=>keccak256(new TextEncoder().encode(s)).slice(0,10);
async function call(to,data,value="0x0",from){const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to,data,value,...(from?{from}:{})},'latest']})});return (await r.json());}

// 1) Identify 0x73694fe2 among candidate error names
const errs=['MustBeNounerToCreateUpdateAndUseSetters()','SlugAlreadyUsed()','ProposalInfoArityMismatch()','MustProvideActions()','InvalidSupportValue()','VoteOnExpiredProposalCandidate()','InvalidEthSentToCreateCandidate()','MustBeNounerOrPaySufficientFee()','FeeMustBePaid()'];
for(const e of errs){ const s=sel(e); if(s==='0x73694fe2') console.log('0x73694fe2 ===', e); }
console.log('selectors:', errs.map(e=>`${e}=${sel(e)}`).join('\n  '));

// 2) get a noun holder
const owner='0x'+(await call(TOKEN, sel('ownerOf(uint256)')+(40).toString(16).padStart(64,'0'))).result.slice(26);
const bal=BigInt((await call(TOKEN, sel('balanceOf(address)')+owner.slice(2).padStart(64,'0'))).result);
console.log(`\nnoun-holder ${owner} holds ${bal} nouns`);

// 3) simulate empty-tx candidate from the holder, value 0
const abi=[{type:'function',name:'createProposalCandidate',stateMutability:'payable',inputs:[{type:'address[]'},{type:'uint256[]'},{type:'string[]'},{type:'bytes[]'},{type:'string'},{type:'string'},{type:'uint256'}],outputs:[]}];
const cd=encodeFunctionData({abi,functionName:'createProposalCandidate',args:[[],[],[],[],"desc","slug-feechk-x",0n]});
const r0=await call(DATA, cd, "0x0", owner);
console.log('holder + value 0 →', r0.error ? ('REVERT '+(r0.error.data||r0.error.message)) : 'OK');

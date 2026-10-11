import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

const app=express();
app.use(helmet({contentSecurityPolicy:false}));
app.use(express.json({limit:'32kb'}));
const PORT=process.env.PORT||3000;
const BOT_TOKEN=process.env.BOT_TOKEN;
const ADMIN_TELEGRAM_ID=process.env.ADMIN_TELEGRAM_ID;
const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase=SUPABASE_URL&&SUPABASE_SERVICE_ROLE_KEY?createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}}):null;
const fail=(res,status,msg)=>res.status(status).json({error:msg});
const needDb=(req,res,next)=>{if(!supabase)return fail(res,503,'Database is not configured.');next()};

function verifyTelegramInitData(initData){
 if(!BOT_TOKEN||!initData||typeof initData!=='string')return null;
 const params=new URLSearchParams(initData),hash=params.get('hash');if(!hash)return null;params.delete('hash');
 const authDate=Number(params.get('auth_date'));if(!authDate||Date.now()/1000-authDate>86400)return null;
 const data=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
 const calculated=crypto.createHmac('sha256',secret).update(data).digest('hex');
 const a=Buffer.from(hash,'hex'),b=Buffer.from(calculated,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;
 try{const u=JSON.parse(params.get('user')||'{}');return u.id?{id:String(u.id),username:u.username||null,first_name:u.first_name||'Player'}:null}catch{return null}
}
async function auth(req,res,next){
 const raw=req.get('x-telegram-init-data')||req.body?.initData||req.query?.initData;
 const user=verifyTelegramInitData(raw);
 if(!user)return fail(res,401,'Valid Telegram Mini App authentication is required.');
 req.user=user;next();
}
app.get('/health',(req,res)=>res.json({ok:true,service:'aircoin-arcade',database:!!supabase}));
app.get('/api/config',(req,res)=>res.json({aircoinPerAd:1,dailyAdLimit:100,aircoinPerGram:10000,minWithdrawal:100,network:process.env.TON_NETWORK||'mainnet',features:{database:!!supabase,adsgram:!!process.env.ADSGRAM_BLOCK_ID,telegramAuth:!!BOT_TOKEN}}));
app.get('/api/me',auth,needDb,async(req,res)=>{
 const {data,error}=await supabase.from('profiles').select('telegram_id,username,first_name,aircoins,created_at').eq('telegram_id',req.user.id).maybeSingle();
 if(error)return fail(res,500,'Could not load profile.');
 if(!data){const {data:created,error:e}=await supabase.from('profiles').insert({telegram_id:req.user.id,username:req.user.username,first_name:req.user.first_name}).select().single();if(e)return fail(res,500,'Could not create profile.');return res.json({profile:created})}
 res.json({profile:data});
});
app.post('/api/scores',auth,needDb,async(req,res)=>{
 const schema=z.object({gameId:z.string().min(1).max(40),score:z.number().int().min(0).max(1000000),durationSeconds:z.number().int().min(0).max(86400)});
 const parsed=schema.safeParse(req.body);if(!parsed.success)return fail(res,400,'Invalid score submission.');
 // This endpoint records a claimed score only; production deployment must validate gameplay/server replay
 // before trusting it for prizes. Client-reported score is not proof of play.
 const {gameId,score,durationSeconds}=parsed.data;
 const {data,error}=await supabase.rpc('submit_score',{p_telegram_id:req.user.id,p_game_id:gameId,p_score:score,p_duration_seconds:durationSeconds});
 if(error)return fail(res,400,'Score could not be recorded. Check database migration and game ID.');
 res.json({ok:true,result:data});
});
app.get('/api/leaderboard/:gameId',needDb,async(req,res)=>{
 const gameId=String(req.params.gameId).slice(0,40);
 const {data,error}=await supabase.from('leaderboard_view').select('game_id,telegram_id,username,score,created_at').eq('game_id',gameId).order('score',{ascending:false}).limit(50);
 if(error)return fail(res,500,'Could not load leaderboard.');res.json({items:data});
});
app.post('/api/rewards/claim',auth,needDb,async(req,res)=>{
 const schema=z.object({provider:String,placementId:z.string().min(1).max(100),verificationToken:z.string().min(8).max(4000)});
 const p=schema.safeParse(req.body);if(!p.success)return fail(res,400,'Invalid reward claim.');
 // Do not credit coins from a browser callback alone. Implement Adsgram's current server-side
 // verification/signature flow here and verify its token with the provider before calling the SQL RPC.
 return fail(res,501,'Ads provider verification is not configured; no AirCoins were credited.');
});
app.post('/api/withdrawals',auth,needDb,async(req,res)=>{
 const p=z.object({amount:z.number().int().min(100).max(100000000),destination:z.string().min(20).max(100)}).safeParse(req.body);
 if(!p.success)return fail(res,400,'Minimum withdrawal is 100 AirCoins and destination must be valid.');
 const {data,error}=await supabase.rpc('request_withdrawal',{p_telegram_id:req.user.id,p_amount:p.data.amount,p_destination:p.data.destination});
 if(error)return fail(res,400,error.message.includes('INSUFFICIENT')?'Insufficient AirCoin balance.':error.message.includes('MIN_WITHDRAWAL')?'Minimum withdrawal is 100 AirCoins.':'Could not create withdrawal request.');
 res.json({ok:true,request:data});
});
app.get('/api/admin/withdrawals',auth,needDb,async(req,res)=>{
 if(!ADMIN_TELEGRAM_ID||req.user.id!==ADMIN_TELEGRAM_ID)return fail(res,403,'Admin access required.');
 const {data,error}=await supabase.from('withdrawal_requests').select('*').order('created_at',{ascending:true}).limit(100);
 if(error)return fail(res,500,'Could not load withdrawal queue.');res.json({items:data});
});
app.post('/api/admin/withdrawals/:id/status',auth,needDb,async(req,res)=>{
 if(!ADMIN_TELEGRAM_ID||req.user.id!==ADMIN_TELEGRAM_ID)return fail(res,403,'Admin access required.');
 const p=z.object({status:z.enum(['approved','rejected','paid']),txHash:z.string().max(150).optional()}).safeParse(req.body);if(!p.success)return fail(res,400,'Invalid status update.');
 const {data,error}=await supabase.rpc('admin_update_withdrawal',{p_request_id:req.params.id,p_status:p.data.status,p_tx_hash:p.data.txHash||null,p_admin_id:req.user.id});
 if(error)return fail(res,400,'Could not update withdrawal request.');res.json({ok:true,request:data});
});
app.listen(PORT,()=>console.log(`AirCoin Arcade API listening on ${PORT}`));

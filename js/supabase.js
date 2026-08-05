// ═══════════════════════════════════════════════════════════
// FITQUEST — supabase.js
// Cliente Supabase, helper de localStorage (DB), sincronização
// de dados do aluno (syncU/loadUDB) e health check do backend.
// ═══════════════════════════════════════════════════════════

// ══ SUPABASE ══
const FQ_VERSION='v114';console.log('%cFitQuest '+FQ_VERSION,'color:#e50914;font-weight:bold;font-size:14px');
// ══ PROXY DE IA (Cloudflare Worker) ══
// Quando preenchido, a IA real funciona em produção com a chave protegida no servidor.
// Deixe '' para usar o plano local (fallback). Ex: 'https://fitquest-ai.SEU-USUARIO.workers.dev'
const AI_PROXY_URL='';
const SUPABASE_URL='https://ctbmnvlsvdlrohkcalcm.supabase.co';
const SUPABASE_KEY='sb_publishable_0jwz3vKIkAakkn8tgNrKKQ_EELiP41g'; // publishable key (segura para frontend — protegida via RLS no Supabase)
const FN_URL=SUPABASE_URL+'/functions/v1';
let sb=null;
try{
  if(typeof supabase!=='undefined' && supabase.createClient){
    sb=supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
    console.log('Supabase connected');
  }
}catch(e){console.warn('Supabase init failed, running offline:',e.message);}

const DB={get(k){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}},set(k,v){localStorage.setItem(k,JSON.stringify(v));},del(k){localStorage.removeItem(k);}};
function rowToUser(data){
  return{id:data.id,name:data.nome,email:data.email,plano:data.plano,trialInicio:data.trial_inicio,runInicio:data.run_inicio,assinaturaStatus:data.assinatura_status||'trial',assinaturaAte:data.assinatura_ate,diaConversao:data.dia_conversao,dataConversao:data.data_conversao,planoConversao:data.plano_conversao,precoTravado:data.preco_travado,promoFundador:!!data.promo_fundador,promoVaga:data.promo_vaga,trainApproved:data.treino_liberado,isAdmin:!!data.is_admin,aiPlan:data.ai_plan,anamnese:data.anamnese,anamneseDone:!!data.anamnese_geral,anamneseGeral:data.anamnese_geral||null,anamneseMusculacao:data.anamnese_musculacao||null,anamneseCorrida:data.anamnese_corrida||null,anamneseMuscDone:!!data.anamnese_musculacao,anamneseCorridaDone:!!data.anamnese_corrida,gymWeek:data.gym_week||1,runWeek:data.run_week||1,gymDone:data.gym_done||{},runDone:data.run_done||{},loadHistory:data.load_history||{},workoutHistory:data.workout_history||[],xp:data.xp||0,level:data.level||1,streak:data.streak||1,coins:data.coins||0,badges:data.badges||[],prs:data.prs||[],stats:data.stats||{treinos:0,distancia:0,semanas:0},purchases:data.purchases||[],pacoteEbooks:!!data.pacote_ebooks,programIntakes:data.program_intakes||{},avatar:data.avatar||null,evals:data.evals||[],missions:MISSOES_PADRAO.map(m=>({...m})),createdAt:data.criado_em,lastLogin:data.ultimo_acesso};
}
function userToRow(u){
  return{id:u.id,nome:u.name,email:u.email,plano:u.plano||'free',trial_inicio:u.trialInicio||new Date().toISOString(),run_inicio:u.runInicio||null,treino_liberado:u.trainApproved||false,ai_plan:u.aiPlan||null,anamnese:u.anamnese||null,anamnese_geral:u.anamneseGeral||null,anamnese_musculacao:u.anamneseMusculacao||null,anamnese_corrida:u.anamneseCorrida||null,gym_week:u.gymWeek||1,run_week:u.runWeek||1,gym_done:u.gymDone||{},run_done:u.runDone||{},load_history:u.loadHistory||{},workout_history:u.workoutHistory||[],xp:u.xp||0,level:u.level||1,streak:u.streak||1,coins:u.coins||0,badges:u.badges||[],prs:u.prs||[],stats:u.stats||{treinos:0,distancia:0,semanas:0},avatar:u.avatar||null,evals:u.evals||[],program_intakes:u.programIntakes||{},ultimo_acesso:new Date().toISOString(),updated_at:new Date().toISOString()};
  // Obs.: purchases/pacote_ebooks/is_admin/plano NÃO são enviados pelo aluno — são protegidos no banco e só mudam via webhook de pagamento ou admin.
}
async function syncU(u){if(!sb||!u||!u.id)return;try{await sb.from('alunos').upsert(userToRow(u),{onConflict:'id'});}catch(e){console.warn('sync:',e.message);}}
async function loadUDB(userId){if(!sb||!userId)return null;try{const{data}=await sb.from('alunos').select('*').eq('id',userId).single();if(!data)return null;return rowToUser(data);}catch(e){return null;}}

// ══ HEALTH CHECK — avisa se o Supabase está fora do ar/pausado ══
async function fqHealthCheck(){
  if(!sb)return;
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),8000);
    const r=await fetch(SUPABASE_URL+'/auth/v1/health',{signal:ctrl.signal,headers:{apikey:SUPABASE_KEY}});
    clearTimeout(t);
    if(!r.ok)throw new Error('status '+r.status);
  }catch(e){
    console.warn('Health check falhou:',e.message);
    if(typeof fqToast==='function')fqToast('⚠️ Servidor indisponível no momento. Se você é o administrador: verifique se o projeto Supabase está pausado (app.supabase.com → Restore).','warn',10000);
  }
}
setTimeout(fqHealthCheck,3000);



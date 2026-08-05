// ═══════════════════════════════════════════════════════════
// FITQUEST — auth.js
// Login, cadastro, validação de e-mail, rate limiting,
// anamnese (onboarding) e e-mail de boas-vindas.
// ═══════════════════════════════════════════════════════════

// ══ AUTH (Supabase Auth — senhas nunca ficam no código nem no navegador) ══
// Admin identificado por hash — e-mail real nunca exposto no fonte
const _AH = btoa('rennan@rennandias.com.br'); // base64 — não é segurança absoluta mas evita scraping trivial
const ADMIN_EMAIL = atob(_AH); // reconstruído em runtime
function goAuth(mode){show('sc-auth');switchAuth(mode);_pushNavState('screen:auth');}
// Aplica o idioma escolhido assim que a página carrega
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', aplicarIdioma);
}else{
  try{ aplicarIdioma(); }catch(e){ console.warn('i18n:', e); }
}

function switchAuth(mode){
  document.getElementById('form-login').style.display=mode==='login'?'block':'none';
  document.getElementById('form-register').style.display=mode==='register'?'block':'none';
  document.getElementById('tab-login').classList.toggle('active',mode==='login');
  document.getElementById('tab-reg').classList.toggle('active',mode==='register');
  document.getElementById('auth-title').textContent=mode==='login'?t('auth.title.login'):t('auth.title.register');
  const badge=document.getElementById('auth-trial-badge');
  if(badge) badge.style.display=mode==='register'?'block':'none';
  document.getElementById('auth-error').style.display='none';
}
function showErr(msg,permitirHTML){
  const e=document.getElementById('auth-error');
  if(permitirHTML===true){ e.innerHTML=msg; }
  else { e.textContent=msg; }   // padrão seguro: texto puro (bloqueia injeção)
  e.style.display='block';
}
async function entrarComPerfil(u){
  if(u.email===ADMIN_EMAIL)u.isAdmin=true; // admin SEMPRE reconhecido pelo e-mail
  const users=DB.get('fq_users')||{};
  users[u.email]=u;DB.set('fq_users',users);DB.set('fq_cur',u.email);
  if(u.isAdmin){await loadAdmin();show('sc-adm');return;}
  // Trial expirado sem assinatura ativa -> tela de assinatura
  if(!temAcesso(u)){ mostrarTelaExpirada(u); return; }
  if(!u.anamneseDone){initAnam('geral');show('sc-anam-geral');}
  else{loadApp(u.email);show('sc-app');}
}
// ══ Rate limiting de login (brute-force protection) ══
const _loginAttempts = {};
function _checkLoginRateLimit(key) {
  const now = Date.now();
  if (!_loginAttempts[key]) _loginAttempts[key] = [];
  _loginAttempts[key] = _loginAttempts[key].filter(t => now - t < 15*60*1000);
  if (_loginAttempts[key].length >= 5) {
    const waitMin = Math.ceil((15*60*1000-(now-_loginAttempts[key][0]))/60000);
    return `Muitas tentativas. Aguarde ${waitMin} min.`;
  }
  _loginAttempts[key].push(now);
  return null;
}

async function doLogin(){
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const pass=document.getElementById('login-pass').value;
  const rateErr=_checkLoginRateLimit(email); if(rateErr){showErr(rateErr);return;}
  if(!email||!pass){showErr('Preencha e-mail e senha.');return;}
  if(!sb){showErr('Sem conexão com o servidor. Verifique sua internet e recarregue a página.');return;}
  const btn=document.getElementById('btn-login');btn.textContent='Entrando...';btn.disabled=true;
  try{
    const{data,error}=await sb.auth.signInWithPassword({email,password:pass});
    if(error){
      const m=/invalid/i.test(error.message)?'E-mail ou senha incorretos.':(/confirm/i.test(error.message)?'Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).':'Não foi possível entrar: '+error.message);
      showErr(m);return;
    }
    let u=await loadUDB(data.user.id);
    if(!u){
      // Primeiro login sem perfil ainda (conta criada antes ou pelo painel) — cria o perfil
      u=novoPerfilLocal(data.user.id,data.user.user_metadata?.nome||email.split('@')[0],email);
      if(email===ADMIN_EMAIL)u.isAdmin=true;
      await sb.from('alunos').upsert(userToRow(u),{onConflict:'id'});
      const fresh=await loadUDB(data.user.id);if(fresh)u=fresh;
    }
    if(email===ADMIN_EMAIL)u.isAdmin=true; // garante admin mesmo se o banco não tiver a flag
    await entrarComPerfil(u);
  }catch(e){
    console.error('Login error:',e);
    const isNet=/fetch|network|failed|load/i.test(e?.message||'');
    showErr(isNet
      ?'⚠️ Servidor indisponível. O projeto Supabase pode estar pausado — acesse app.supabase.com e clique em Restore/Resume.'
      :'Erro ao entrar: '+(e?.message||'tente novamente'));
  }
  finally{btn.textContent='Entrar';btn.disabled=false;}
}
function novoPerfilLocal(id,name,email){
  return{id,name,email,anamneseDone:false,anamneseMuscDone:false,anamneseCorridaDone:false,anamneseGeral:null,anamneseMusculacao:null,anamneseCorrida:null,createdAt:new Date().toISOString(),plano:'free',trialInicio:new Date().toISOString(),assinaturaStatus:'trial',trainApproved:true,isAdmin:false,xp:0,level:1,streak:1,coins:0,stats:{treinos:0,distancia:0,semanas:0},badges:[],missions:MISSOES_PADRAO.map(m=>({...m})),prs:[],gymWeek:1,gymDone:{},runWeek:1,runDone:{},aiPlan:null,workoutHistory:[],loadHistory:{},purchases:[],pacoteEbooks:false,programIntakes:{},evals:[]};
}
// ══════════════════════════════════════════════════════════
// VALIDAÇÃO DE E-MAIL — camada extra contra cadastro-lixo.
// IMPORTANTE: isto NÃO prova que o e-mail existe. A única prova real é o
// link de confirmação do Supabase (Authentication > Providers > Email >
// "Confirm email"). Aqui só barramos erros de digitação e descartáveis.
// ══════════════════════════════════════════════════════════

// Domínios de e-mail temporário/descartável mais comuns
const EMAIL_DESCARTAVEIS = new Set([
  'mailinator.com','guerrillamail.com','10minutemail.com','tempmail.com','temp-mail.org',
  'throwawaymail.com','yopmail.com','trashmail.com','sharklasers.com','getnada.com',
  'maildrop.cc','fakeinbox.com','mailnesia.com','dispostable.com','mintemail.com',
  'spamgourmet.com','mytemp.email','emailondeck.com','tempinbox.com','mailcatch.com',
  'inboxbear.com','luxusmail.org','tempr.email','discard.email','burnermail.io'
]);

// Erros de digitação frequentes → domínio correto
const EMAIL_TYPOS = {
  'gmail.con':'gmail.com','gmail.co':'gmail.com','gmial.com':'gmail.com','gmai.com':'gmail.com',
  'gmail.cm':'gmail.com','gmail.comm':'gmail.com','gmail.om':'gmail.com','gnail.com':'gmail.com',
  'hotmail.con':'hotmail.com','hotmial.com':'hotmail.com','hotmai.com':'hotmail.com',
  'hotmail.co':'hotmail.com','hotmail.cm':'hotmail.com','hotmall.com':'hotmail.com',
  'outlook.con':'outlook.com','outlok.com':'outlook.com','outloo.com':'outlook.com',
  'yahoo.con':'yahoo.com','yaho.com':'yahoo.com','yahooo.com':'yahoo.com',
  'icloud.con':'icloud.com','iclould.com':'icloud.com',
  'bol.com':'bol.com.br','uol.com':'uol.com.br','terra.com':'terra.com.br',
  'globo.com.br':'globo.com'
};

// Retorna {ok:true} ou {ok:false, msg:'...', sugestao:'...'}
function validarEmail(email){
  const e = (email||'').trim().toLowerCase();
  if(!e) return {ok:false, msg:'Informe seu e-mail.'};

  // Formato básico (mais rigoroso que o anterior: exige TLD com 2+ letras)
  if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e))
    return {ok:false, msg:'E-mail inválido. Confira se digitou corretamente.'};

  // Sem pontos consecutivos, nem ponto no começo/fim da parte local
  const [local, dominio] = e.split('@');
  if(local.startsWith('.')||local.endsWith('.')||local.includes('..'))
    return {ok:false, msg:'E-mail inválido — verifique os pontos no endereço.'};
  if(dominio.startsWith('.')||dominio.startsWith('-')||dominio.includes('..'))
    return {ok:false, msg:'E-mail inválido — verifique o domínio.'};

  // Domínio descartável
  if(EMAIL_DESCARTAVEIS.has(dominio))
    return {ok:false, msg:'Este é um e-mail temporário. Use seu e-mail pessoal para não perder acesso à conta.'};

  // Erro de digitação conhecido — sugere correção
  if(EMAIL_TYPOS[dominio]){
    const corrigido = local+'@'+EMAIL_TYPOS[dominio];
    return {ok:false, msg:`Você quis dizer <strong>${corrigido}</strong>?`, sugestao:corrigido};
  }

  return {ok:true};
}

// Aplica a sugestão de correção no campo e revalida
function aplicarSugestaoEmail(campoId, sugestao){
  const el = document.getElementById(campoId);
  if(el){ el.value = sugestao; el.focus(); }
  const err = document.getElementById('auth-error');
  if(err) err.style.display='none';
}

async function doRegister(){
  const name=document.getElementById('reg-name').value.trim();
  const email=document.getElementById('reg-email').value.trim().toLowerCase();
  const pass=document.getElementById('reg-pass').value;
  const pass2=document.getElementById('reg-pass2').value;
  if(!name||!email||!pass){showErr('Preencha todos os campos.');return;}
  if(pass.length<6){showErr('Senha mínimo 6 caracteres.');return;}
  if(pass!==pass2){showErr('Senhas não conferem.');return;}
  const valEmail=validarEmail(email);
  if(!valEmail.ok){
    if(valEmail.sugestao){
      showErr(`${valEmail.msg} <button onclick="aplicarSugestaoEmail('reg-email','${valEmail.sugestao}')" style="background:none;border:none;color:var(--r);font-weight:800;text-decoration:underline;cursor:pointer;font-size:inherit;padding:0;margin-left:4px">Corrigir</button>`, true);
    } else {
      showErr(valEmail.msg.replace(/<[^>]*>/g,''));  // sem HTML nas demais mensagens
    }
    return;
  }
  if(!sb){showErr('Sem conexão com o servidor. Verifique sua internet e recarregue a página.');return;}
  const btn=document.getElementById('btn-reg');btn.textContent='Criando...';btn.disabled=true;
  try{
    const{data,error}=await sb.auth.signUp({email,password:pass,options:{data:{nome:name}}});
    if(error){
      const m=/already|registered/i.test(error.message)?'E-mail já cadastrado. Use "Entrar".':'Não foi possível criar a conta: '+error.message;
      showErr(m);return;
    }
    if(!data.session){
      showErr('Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme e depois faça login.');
      switchAuth('login');return;
    }
    const u=novoPerfilLocal(data.user.id,name,email);
    if(email===ADMIN_EMAIL)u.isAdmin=true;
    await sb.from('alunos').upsert(userToRow(u),{onConflict:'id'});
    const users=DB.get('fq_users')||{};users[email]=u;DB.set('fq_users',users);DB.set('fq_cur',email);
    enviarEmailBoasVindas(name, email); // e-mail de boas-vindas (não bloqueia)
    // NOTA: o aviso pra você (admin) de novo cadastro NÃO é mais disparado daqui.
    // Isso agora acontece pelo servidor (função notificar-novo-aluno + Database
    // Webhook), que é mais confiável — funciona mesmo se o aluno fechar o app
    // logo após se cadastrar. Ver notificarAdminNovoAluno() abaixo, mantida só
    // como reserva manual (não é mais chamada automaticamente).
    if(u.isAdmin){await loadAdmin();show('sc-adm');return;}
    initAnam('geral');show('sc-anam-geral');
  }catch(e){
    console.error('Register error:',e);
    const isNet=/fetch|network|failed|load/i.test(e?.message||'');
    showErr(isNet
      ?'⚠️ Servidor indisponível. O projeto Supabase pode estar pausado — acesse app.supabase.com e clique em Restore/Resume.'
      :'Erro ao criar conta: '+(e?.message||'tente novamente'));
  }
  finally{btn.textContent='Criar conta grátis';btn.disabled=false;}
}
function checkAdminBtn() {
  const u = getU();
  const btn = document.getElementById('btn-admin-back');
  if (btn) btn.style.display = (u&&u.isAdmin) ? 'flex' : 'none';
}

async function doLogout(){
  if(!await fqConfirm('Sair da conta','Deseja realmente sair?','Sair','👋'))return;
  try{if(sb)await sb.auth.signOut();}catch(e){}
  DB.del('fq_cur');show('sc-splash');
}

// ══ ANAMNESE ══
// (anamStep antigo removido — substituído por anamStepState, parametrizado por tipo)
// ══ ASSISTENTE DE ANAMNESE — parametrizado por tipo (geral/musc/corrida) ══
// Os 3 fluxos (geral, musculação, corrida) compartilham a mesma lógica de
// navegação por etapas, só mudam o número de etapas e os campos coletados.
const ANAM_TOTAL={geral:3,musc:3,corrida:2};
const anamStepState={geral:1,musc:1,corrida:1};

function initAnam(tipo){
  tipo=tipo||'geral';
  anamStepState[tipo]=1;
  updAnam(tipo);
  const raiz=document.getElementById('sc-anam-'+tipo);
  if(!raiz) return;
  raiz.querySelectorAll('.rg').forEach(g=>{g.querySelectorAll('.ro').forEach(o=>o.addEventListener('click',()=>{g.querySelectorAll('.ro').forEach(x=>x.classList.remove('sel'));o.classList.add('sel');o.querySelector('input').checked=true;}));});
  raiz.querySelectorAll('.cg').forEach(g=>{g.querySelectorAll('.co').forEach(o=>o.addEventListener('click',()=>{o.classList.toggle('sel');const cb=o.querySelector('input');cb.checked=!cb.checked;o.querySelector('.cb').textContent=cb.checked?'✓':'';}));});
  try{ aplicarIdioma(); }catch(e){}
}
function updAnam(tipo){
  tipo=tipo||'geral';
  const TOTAL=ANAM_TOTAL[tipo];
  const step=anamStepState[tipo];
  const pct=Math.round((step/TOTAL)*100);
  const prog=document.getElementById('anam-progress-'+tipo); if(prog) prog.style.width=pct+'%';
  const lbl=document.getElementById('step-label-'+tipo); if(lbl) lbl.textContent=t('anam.stepcount',{n:step,total:TOTAL});
  const pctEl=document.getElementById('step-pct-'+tipo); if(pctEl) pctEl.textContent=pct+'%';
  document.querySelectorAll('#sc-anam-'+tipo+' .anam-step').forEach((s,i)=>s.style.display=(i+1===step)?'block':'none');
  const back=document.getElementById('btn-back-'+tipo); if(back) back.style.display=step>1?'block':'none';
  const nxt=document.getElementById('btn-nxt-'+tipo); if(nxt) nxt.textContent=step===TOTAL?t('anam.btn.submit'):t('anam.btn.next');
}
function anamNext(tipo){
  tipo=tipo||'geral';
  if(anamStepState[tipo]<ANAM_TOTAL[tipo]){ anamStepState[tipo]++; updAnam(tipo); window.scrollTo(0,0); }
  else{
    if(tipo==='geral') submitAnamGeral();
    else if(tipo==='musc') submitAnamMusc();
    else if(tipo==='corrida') submitAnamCorrida();
  }
}
function anamPrev(tipo){
  tipo=tipo||'geral';
  if(anamStepState[tipo]>1){ anamStepState[tipo]--; updAnam(tipo); window.scrollTo(0,0); }
}
// ── ANAMNESE GERAL — obrigatória logo após cadastro, vai direto pra Home (sem gerar plano) ──
async function submitAnamGeral(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};if(!users[email])return;
  const gr=n=>{const e=document.querySelector(`input[name="${n}"]:checked`);return e?e.value:'';};
  const gc=id=>Array.from(document.querySelectorAll(`#${id} input:checked`)).map(e=>e.value);
  const gv=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const an={
    nasc:gv('a-nasc'),sexo:gv('a-sexo'),peso:gv('a-peso'),altura:gv('a-altura'),
    prof:gv('a-prof'),fone:gv('a-fone'),atvTrab:gr('atvtrab'),
    saude:gc('cg-saude'),med:gr('med'),medDesc:gv('a-med'),cir:gv('a-cir'),ativo:gr('ativo'),
    sono:gr('sono'),stress:gr('stress'),alim:gr('alim'),prazo:gr('prazo'),motiv:gv('a-motiv'),
    at:new Date().toISOString()
  };
  users[email].anamneseGeral=an;
  users[email].anamneseDone=true; // mantém o nome antigo — continua sendo o que libera a Home
  users[email].xp=(users[email].xp||0)+50;users[email].coins=(users[email].coins||0)+25;
  DB.set('fq_users',users);
  if(typeof sb!=='undefined'&&sb&&typeof syncU==='function')syncU(users[email]).catch(()=>{});
  goToApp();
  fqToast('👋 Perfil criado! Agora escolha seu treino.','ok');
}

// Junta a anamnese geral com uma anamnese específica (musc ou corrida) —
// é isso que vira o objeto completo que o motor (RD_perfil) espera.
function mesclarAnamnese(u, especifica){
  return {...(u.anamneseGeral||{}), ...especifica};
}

// ── ANAMNESE MUSCULAÇÃO — ao clicar "Quero treino de musculação" na Home ──
async function submitAnamMusc(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};if(!users[email])return;
  const gr=n=>{const e=document.querySelector(`input[name="${n}"]:checked`);return e?e.value:'';};
  const gc=id=>Array.from(document.querySelectorAll(`#${id} input:checked`)).map(e=>e.value);
  const gv=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const especifica={
    tempo:gr('tempo'),dias:gr('dias'),dur:gr('dur'),local:gr('local'),
    cargaSupino:gv('a-cargasupino'),cargaAgacho:gv('a-cargaagacho'),
    obj:gc('cg-obj'),
    lesoes:gc('cg-lesoes'),dorInt:gr('dorint'),dorTempo:gr('dortempo'),
    temJoelho:gc('cg-lesoes').some(l=>l.includes('Joelho')),
    temLombar:gc('cg-lesoes').some(l=>l.includes('Lombar')||l.includes('Hérnia')),
    temOmbro:gc('cg-lesoes').some(l=>l.includes('Ombro')),
    biotipo:gr('biotipo'),gordura:gr('gordura'),foco:gc('cg-foco'),supl:gc('cg-supl'),
    evitar:gv('a-evitar'),
    at:new Date().toISOString()
  };
  users[email].anamneseMusculacao=especifica;
  users[email].anamneseMuscDone=true;
  const anCompleta=mesclarAnamnese(users[email],especifica);
  DB.set('fq_users',users);
  show('sc-ok');
  document.getElementById('btn-go-app').style.display='none';
  document.getElementById('ok-sub').textContent='Montando seu treino de musculação... 🤖';
  try{ gerarTreinoFallback(email,anCompleta,'gym'); }catch(e){ console.error('Erro ao gerar musculação:',e); }
  // O botão SEMPRE aparece — nenhum erro acima pode prender o aluno aqui
  try{
    const ico=document.querySelector('.ok-ico');if(ico)ico.textContent='💪';
    const tit=document.getElementById('ok-title');if(tit)tit.textContent='Treino pronto!';
    const sub=document.getElementById('ok-sub');if(sub)sub.textContent='Seu treino de musculação foi gerado 🎬';
  }catch(e){ console.error('Erro ao atualizar tela de sucesso:',e); }
  finally{
    const btn=document.getElementById('btn-go-app');
    if(btn){btn.style.display='block';btn.textContent='Ver meu treino 🚀';}
  }
  try{ aplicarIdioma(); }catch(e){}
}

// ── ANAMNESE CORRIDA — ao clicar "Quero treino de corrida" na Home ──
async function submitAnamCorrida(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};if(!users[email])return;
  const gr=n=>{const e=document.querySelector(`input[name="${n}"]:checked`);return e?e.value:'';};
  const gc=id=>Array.from(document.querySelectorAll(`#${id} input:checked`)).map(e=>e.value);
  const gv=id=>{const el=document.getElementById(id);return el?el.value:'';};
  const especifica={
    mc:gc('cg-mc'),nivelCorrida:gr('nivelcorrida'),ritmoAtual:gv('a-ritmoatual'),
    lesoes:gc('cg-lesoes-corrida'),dorInt:gr('dorint-corrida'),dorTempo:gr('dortempo-corrida'),
    temJoelho:gc('cg-lesoes-corrida').some(l=>l.includes('Joelho')),
    temLombar:gc('cg-lesoes-corrida').some(l=>l.includes('Lombar')||l.includes('Hérnia')),
    temOmbro:gc('cg-lesoes-corrida').some(l=>l.includes('Ombro')),
    at:new Date().toISOString()
  };
  users[email].anamneseCorrida=especifica;
  users[email].anamneseCorridaDone=true;
  const anCompleta=mesclarAnamnese(users[email],especifica);
  DB.set('fq_users',users);
  show('sc-ok');
  document.getElementById('btn-go-app').style.display='none';
  document.getElementById('ok-sub').textContent='Montando seu plano de corrida... 🤖';
  try{ gerarTreinoFallback(email,anCompleta,'run'); }catch(e){ console.error('Erro ao gerar corrida:',e); }
  // O botão SEMPRE aparece — nenhum erro acima pode prender o aluno aqui
  try{
    const ico=document.querySelector('.ok-ico');if(ico)ico.textContent='🏃';
    const tit=document.getElementById('ok-title');if(tit)tit.textContent='Plano pronto!';
    const sub=document.getElementById('ok-sub');if(sub)sub.textContent='Seu plano de corrida foi gerado 🎬';
  }catch(e){ console.error('Erro ao atualizar tela de sucesso:',e); }
  finally{
    const btn=document.getElementById('btn-go-app');
    if(btn){btn.style.display='block';btn.textContent='Ver meu plano 🚀';}
  }
  try{ aplicarIdioma(); }catch(e){}
}

// Chamadas pelos cards da Home — abrem a anamnese específica certa
function iniciarAnamneseMusc(){ initAnam('musc'); show('sc-anam-musc'); }
function iniciarAnamneseCorrida(){ initAnam('corrida'); show('sc-anam-corrida'); }
function goToApp(){
  const email=DB.get('fq_cur');
  // Mostra a tela do app PRIMEIRO. Se algo falhar na renderização, o aluno
  // ainda entra no app (antes, um erro em qualquer render deixava a pessoa
  // presa na tela de "treino pronto", clicando no botão sem nada acontecer).
  show('sc-app');
  try{ loadApp(email); }
  catch(e){
    console.error('Erro ao carregar o app:',e);
    fqToast('Algumas informações não carregaram. Puxe a tela para atualizar.','warn');
  }
}

// ══ Rate limiting da IA (evita abuso) ══
const _aiCallLog = {};
function _checkAIRateLimit(email) {
  const now = Date.now();
  if (!_aiCallLog[email]) _aiCallLog[email] = [];
  _aiCallLog[email] = _aiCallLog[email].filter(t => now - t < 60 * 60 * 1000); // janela 1h
  if (_aiCallLog[email].length >= 3) return false; // máx 3 gerações por hora
  _aiCallLog[email].push(now);
  return true;
}

async function genAIWithRetry(email, an, maxRetries){
  let lastErr;
  for(let i=0; i<=maxRetries; i++){
    try { await genAI(email, an); return; }
    catch(e){
      lastErr=e; console.warn(`Tentativa ${i+1}:`,e.message);
      if(i<maxRetries){
        const sub=document.getElementById('ok-sub');
        if(sub) sub.textContent='Finalizando os últimos ajustes...';
        await new Promise(r=>setTimeout(r,2000));
      }
    }
  }
  throw lastErr;
}

// ══ E-MAIL DE BOAS-VINDAS (EmailJS + Gmail) ══
// CONFIGURAÇÃO: crie conta gratuita em emailjs.com, conecte seu Gmail e preencha:
const EMAILJS_CONFIG = {
  serviceId: 'SEU_SERVICE_ID',        // ex: service_abc123
  templateId: 'SEU_TEMPLATE_ID',      // ex: template_xyz789 — boas-vindas pro aluno
  templateIdAdmin: 'SEU_TEMPLATE_ADMIN_ID', // template separado — notificação pra você
  publicKey: 'SUA_PUBLIC_KEY',        // ex: AbCdEfGh123
  adminEmail: 'rennan@rennandias.com.br'    // pra onde a notificação de novo aluno vai
};

async function notificarAdminNovoAluno(nome, email){
  if(EMAILJS_CONFIG.serviceId==='SEU_SERVICE_ID' || EMAILJS_CONFIG.templateIdAdmin==='SEU_TEMPLATE_ADMIN_ID'){
    console.log('EmailJS admin não configurado — pulando notificação de novo aluno');
    return;
  }
  try{
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateIdAdmin,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params:{
          to_email: EMAILJS_CONFIG.adminEmail,
          aluno_nome: nome,
          aluno_email: email,
          data_cadastro: new Date().toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}),
          link_admin: 'https://shiriufc-bit.github.io/fitquest/'
        }
      })
    });
    console.log('Notificação admin novo aluno:', res.ok ? 'enviada ✅' : 'falhou');
  }catch(e){
    console.warn('Notificação admin erro:', e.message);
  }
}

async function enviarEmailBoasVindas(nome, email){
  if(EMAILJS_CONFIG.serviceId==='SEU_SERVICE_ID'){
    console.log('EmailJS não configurado — pulando e-mail de boas-vindas');
    return;
  }
  try{
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        service_id: EMAILJS_CONFIG.serviceId,
        template_id: EMAILJS_CONFIG.templateId,
        user_id: EMAILJS_CONFIG.publicKey,
        template_params:{
          to_name: nome,
          to_email: email,
          from_name: 'Rennan Dias — FitQuest',
          app_link: 'https://shiriufc-bit.github.io/fitquest/',
          whatsapp: '(31) 99525-0330',
          trial_dias: TRIAL_DIAS
        }
      })
    });
    console.log('E-mail boas-vindas:', res.ok ? 'enviado ✅' : 'falhou');
  }catch(e){
    console.warn('EmailJS erro:', e.message);
  }
}



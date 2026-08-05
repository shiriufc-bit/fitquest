// ═══════════════════════════════════════════════════════════
// FITQUEST — app.js
// Núcleo do app: toasts/modais, utils, i18n, missões,
// gamificação (badges/ranking), navegação, avatar, evolução,
// comunidade, PWA e inicialização (init roda por último).
// ═══════════════════════════════════════════════════════════


// ══ DADOS DO BANCO — carregados via fetch de /database/*.json ══
// (antes eram const/let definidos inline; agora vêm de arquivos externos)
let EXERCISE_BANK = [];
let DG = {};
let DR = {};
let EBOOK_FILES = {};
let EBOOKS_CONTENT = {};

const FQ_DATA_READY = (async () => {
  try {
    const [ex, tr, eb] = await Promise.all([
      fetch('database/exercicios.json').then(r => r.json()),
      fetch('database/treinos.json').then(r => r.json()),
      fetch('database/ebooks.json').then(r => r.json()),
    ]);
    EXERCISE_BANK = ex;
    DG = tr.gym;
    DR = tr.run;
    EBOOK_FILES = eb.files;
    EBOOKS_CONTENT = eb.content;
  } catch (e) {
    console.error('Erro ao carregar dados do banco (exercicios/treinos/ebooks):', e);
  }
})();

// ══ UI KIT: TOASTS + MODAIS (substituem alert/confirm nativos) ══
function fqToast(msg,type='info',ms=4000){
  let wrap=document.getElementById('fq-toasts');
  if(!wrap){wrap=document.createElement('div');wrap.id='fq-toasts';document.body.appendChild(wrap);}
  const t=document.createElement('div');
  t.className='fq-toast '+type;
  t.textContent=msg;
  wrap.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('in'));
  setTimeout(()=>{t.classList.remove('in');setTimeout(()=>t.remove(),350);},ms);
}
function fqDialog({title,msg,okText='OK',cancelText=null,icon=''}){
  return new Promise(resolve=>{
    const old=document.getElementById('fq-dialog');if(old)old.remove();
    const ov=document.createElement('div');
    ov.id='fq-dialog';ov.className='fq-dlg-ov';
    ov.innerHTML=`<div class="fq-dlg">
      ${icon?`<div class="fq-dlg-ico">${icon}</div>`:''}
      <div class="fq-dlg-title">${title}</div>
      ${msg?`<div class="fq-dlg-msg">${String(msg).replace(/\n/g,'<br>')}</div>`:''}
      <div class="fq-dlg-btns">
        ${cancelText?`<button class="fq-dlg-btn sec" data-v="0">${cancelText}</button>`:''}
        <button class="fq-dlg-btn pri" data-v="1">${okText}</button>
      </div>
    </div>`;
    ov.addEventListener('click',e=>{
      const b=e.target.closest('.fq-dlg-btn');
      if(b){ov.remove();resolve(b.dataset.v==='1');}
      else if(e.target===ov&&cancelText){ov.remove();resolve(false);}
    });
    document.body.appendChild(ov);
    requestAnimationFrame(()=>ov.classList.add('in'));
  });
}
function fqAlert(title,msg,icon='💡'){return fqDialog({title,msg,icon});}
function fqConfirm(title,msg,okText='Confirmar',icon='🤔'){return fqDialog({title,msg,okText,cancelText:'Cancelar',icon});}

// ══ UTILS ══
function show(id){document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));document.getElementById(id).classList.add('active');window.scrollTo(0,0);}
let _fqNavegandoViaVoltar=false;
// Marca que o history.back() foi disparado pelo próprio código (só pra limpar a
// entrada de histórico do modal), e NÃO por um "voltar" real do usuário.
// Sem isso, fechar qualquer modal no X jogava o aluno de volta pra Home.
let _fqConsumindoHistorico=false;
function closeModal(id){
  const el=document.getElementById(id);
  if(el) el.classList.remove('open');
  // Se o fechamento foi manual (botão X), consome a entrada de histórico criada
  // ao abrir o modal — senão o Voltar precisaria de 2 cliques pra sair depois.
  if(!_fqNavegandoViaVoltar){
    _fqConsumindoHistorico=true;
    try{ history.back(); }catch(e){ _fqConsumindoHistorico=false; }
  }
}
function getExById(id){return EXERCISE_BANK.find(e=>e.id===id)||null;}
function getU(){const e=DB.get('fq_cur');if(!e||e==='__admin__')return null;return(DB.get('fq_users')||{})[e]||null;}
function saveU(u){const users=DB.get('fq_users')||{};users[u.email]=u;DB.set('fq_users',users);syncU(u);}
function getGP(u){const g=u.aiPlan?.gym;return (g&&Object.keys(g).length)?g:DG;}
function getRP(u){const r=u.aiPlan?.run;return (r&&Object.keys(r).length)?r:DR;}
function toggleMenu(){document.getElementById('nav-menu').classList.toggle('open');}
document.addEventListener('click',e=>{if(!e.target.closest('.nav-av')&&!e.target.closest('.nav-menu'))document.getElementById('nav-menu').classList.remove('open');});
window.addEventListener('scroll',()=>{const nav=document.getElementById('app-nav');if(nav)nav.classList.toggle('solid',window.scrollY>50);},{passive:true});

// ══ SUPABASE: SYNC DE DADOS (vinculado ao usuário autenticado) ══
const MISSOES_PADRAO=[{id:1,title:'Treinar 3x esta semana',xp:150,progress:0,total:3,type:'gym',done:false},{id:2,title:'Correr 5km esta semana',xp:200,progress:0,total:5,type:'run',done:false},{id:3,title:'Completar o Deload da Semana 4',xp:500,progress:0,total:1,type:'week',done:false},{id:4,title:'Chegar aos 10km correndo',xp:800,progress:0,total:1,type:'run',done:false}];

// ══ MISSÕES SEMANAIS ROTATIVAS — renovam toda segunda ══
const POOL_MISSOES_SEMANAIS=[
  {title:'Treinar 3x esta semana',xp:150,total:3,type:'gym'},
  {title:'Treinar 4x esta semana',xp:250,total:4,type:'gym'},
  {title:'Completar todos os treinos da semana',xp:400,total:5,type:'gym'},
  {title:'Correr 5km acumulados',xp:200,total:5,type:'run'},
  {title:'Correr 10km acumulados',xp:350,total:10,type:'run'},
  {title:'Fazer 2 treinos de corrida',xp:200,total:2,type:'run'},
  {title:'Bater 1 recorde pessoal (PR)',xp:300,total:1,type:'pr'},
  {title:'Bater 2 recordes pessoais',xp:500,total:2,type:'pr'},
  {title:'Manter streak de 7 dias',xp:400,total:7,type:'week'},
  {title:'Registrar 1 avaliação corporal',xp:250,total:1,type:'week'},
  {title:'Treinar 2 dias seguidos',xp:120,total:2,type:'gym'},
  {title:'Completar treino de pernas sem pular',xp:180,total:1,type:'gym'},
];

function getSegundaDaSemana(){
  const d=new Date();
  const day=d.getDay();
  const diff=d.getDate()-day+(day===0?-6:1);
  const monday=new Date(d.setDate(diff));
  return monday.toDateString();
}

function renovarMissoesSemanais(u){
  if(!u)return false;
  const semanaAtual=getSegundaDaSemana();
  if(u.missoesSemana===semanaAtual)return false; // já renovou esta semana
  // Sortear 3 missões do pool (sem repetir)
  const pool=[...POOL_MISSOES_SEMANAIS];
  const novas=[];
  for(let i=0;i<3&&pool.length;i++){
    const idx=Math.floor(Math.random()*pool.length);
    const m=pool.splice(idx,1)[0];
    novas.push({id:Date.now()+i,title:m.title,xp:m.xp,progress:0,total:m.total,type:m.type,done:false,semanal:true});
  }
  // Manter missões de longo prazo (não semanais) + adicionar novas
  const longoPrazo=(u.missions||[]).filter(m=>!m.semanal&&!m.done);
  u.missions=[...novas,...longoPrazo];
  u.missoesSemana=semanaAtual;
  return true;
}
// ══ BADGES ══
const BADGES=[{id:'b1',icon:'🔥',name:'Streak 7 dias',c:u=>u.streak>=7},{id:'b2',icon:'🏃',name:'Primeira corrida',c:u=>u.stats.distancia>0},{id:'b3',icon:'⚡',name:'10 treinos',c:u=>u.stats.treinos>=10},{id:'b4',icon:'💎',name:'Semana 4 completa',c:u=>(u.gymWeek||1)>4},{id:'b5',icon:'🏋️',name:'50 treinos',c:u=>u.stats.treinos>=50},{id:'b6',icon:'🌟',name:'Streak 30 dias',c:u=>u.streak>=30},{id:'b7',icon:'🚀',name:'10km total',c:u=>u.stats.distancia>=10},{id:'b8',icon:'👑',name:'Programa completo',c:u=>(u.gymWeek||1)>=12}];
// Ranking real — carregado do banco (só nomes próprios de alunos reais, nunca inventados)
let RANKING_CACHE=[];
async function carregarRanking(){
  if(!sb)return[];
  try{
    const{data,error}=await sb.rpc('get_ranking');
    if(error||!data)return[];
    RANKING_CACHE=data.map(r=>({name:r.nome,xp:r.xp||0,level:r.nivel||1}));
    return RANKING_CACHE;
  }catch(e){return[];}
}

// ══ LOAD APP ══
// ══════════════════════════════════════════════════════════
// ASSINATURA — 14 dias grátis, depois plano mensal ou anual.
// Status possíveis: 'trial' | 'ativa' | 'expirada'
// IMPORTANTE: este controle é de EXPERIÊNCIA (mostra/esconde tela).
// A liberação real de acesso pago depende do webhook do Mercado Pago
// atualizar assinatura_status no banco — protegido por RLS.
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// SISTEMA DE IDIOMAS (i18n) — Português / English
// O idioma é detectado do navegador na primeira visita e fica salvo.
// Textos ainda não traduzidos caem no português automaticamente,
// então o app nunca mostra chave crua nem fica em branco.
// ══════════════════════════════════════════════════════════════

const FQ_I18N = {
  pt: {
    // ── Splash ──
    'splash.tagline': 'Rennan Dias Assessoria',
    'splash.title': 'Seu treino.<br>Sua <span class="hl">evolução.</span><br>Seu ritmo.',
    'splash.sub': 'Plataforma de assessoria esportiva com treinos personalizados e acompanhamento completo.',
    'splash.cta': '▶ Testar {dias} dias grátis',
    'splash.login': 'Já tenho uma conta',
    'splash.nocard': '✅ Sem cartão salvo · sem renovação automática',

    // ── Autenticação ──
    'auth.tab.login': 'Entrar',
    'auth.tab.register': 'Criar conta',
    'auth.title.login': 'Entrar na sua conta',
    'auth.title.register': 'Criar conta grátis',
    'auth.trial.badge': '🎁 {dias} dias grátis · sem cartão de crédito',
    'auth.field.name': 'Nome completo',
    'auth.field.email': 'E-mail',
    'auth.field.pass': 'Senha',
    'auth.field.pass2': 'Confirmar senha',
    'auth.btn.login': 'Entrar',
    'auth.btn.register': 'Começar meus {dias} dias grátis',
    'auth.forgot': 'Esqueci minha senha',

    // ── Navegação ──
    'nav.home': 'Início',
    'nav.train': 'Treino',
    'nav.store': 'Loja',
    'nav.coach': 'Coach',
    'nav.social': 'Social',
    'nav.profile': 'Perfil',

    // ── Planos / assinatura ──
    'plan.monthly': 'Mensal',
    'plan.annual': 'Anual',
    'plan.mostchosen': 'MAIS ESCOLHIDO',
    'plan.permonth': '/mês',
    'plan.monthly.note': 'Cobrado mês a mês',
    'plan.annual.note': 'Economize 34% · R$118,80 (em até 12x)',
    'plan.subscribe': 'Assinar plano {plano}',
    'plan.expired.title': 'Seus {dias} dias acabaram, {nome}',
    'plan.expired.sub': 'Continue com musculação e corrida personalizadas,<br/>a Jornada das Missões, e-books e a comunidade completa.',
    'plan.logout': 'Sair da conta',
    'plan.benefit1': '✅ Musculação e corrida sob medida',
    'plan.benefit2': '✅ Jornada com 60 missões gamificadas',
    'plan.benefit3': '✅ Plano de corrida periodizado',
    'plan.benefit4': '✅ Comunidade e ranking',
    'plan.benefit5': '✅ Acompanhamento de evolução',

    // ── Anamnese (estrutura) ──
    'anam.stepcount': 'Etapa {n} de {total}',
    'anam.building': 'Personalizando seu programa',
    'anam.hdr.title': "📋 Avaliação Completa",
    'anam.hdr.sub': "Quanto mais detalhes, mais preciso será seu treino!",
    'anam.sec.1': "👤 Dados Pessoais",
    'anam.sec.2': "🏋️ Experiência de Treino",
    'anam.sec.3': "🎯 Objetivos e Metas",
    'anam.sec.4': "❤️ Histórico de Saúde",
    'anam.sec.5': "🩺 Lesões e Restrições Físicas",
    'anam.sec.6': "📊 Composição e Corpo",
    'anam.sec.7': "🌙 Estilo de Vida e Recuperação",
    'anam.btn.back': "← Voltar",
    'anam.btn.next': "Próxima etapa →",
    'anam.sel.placeholder': "Selecionar",
    'anam.sel.male': "Masculino",
    'anam.sel.female': "Feminino",
    'anam.btn.submit': 'Enviar avaliação ✅',
    'home.wantgym': 'Criar treino de musculação',
    'home.wantrun': 'Criar plano de corrida',
    'anam.g.hdrtitle': '📋 Vamos te conhecer',
    'anam.g.hdrsub': 'Isso ajuda a gente a entender sua saúde e rotina — leva menos de 2 minutos.',
    'anam.g.sec2': '❤️ Saúde',
    'anam.g.sec3': '🌙 Estilo de Vida',
    'anam.m.hdrtitle': '🏋️ Seu Treino de Musculação',
    'anam.m.hdrsub': 'Só o que o motor precisa pra montar seu treino certinho.',
    'anam.m.sec1': '🏋️ Experiência e Estrutura',
    'anam.m.sec2': '🎯 Objetivos',
    'anam.m.sec3': '🩺 Lesões e Composição',
    'anam.c.hdrtitle': '🏃 Seu Treino de Corrida',
    'anam.c.hdrsub': 'Bem rápido — só o essencial pra montar seu plano de corrida.',
    'anam.c.sec1': '🏃 Sua Corrida',
    'anam.c.sec2': '🩺 Lesões',
    'home.wantgym.sub': 'Responda 3 etapas rápidas',
    'home.wantrun.sub': 'Só 2 etapas — bem rápido',
    'home.addplan': '➕ Adicionar ao seu plano',
    // ── Anamnese ──
    'anam.71ef84890d': "Data de nascimento",
    'anam.5c7d7a110a': "Sexo biológico",
    'anam.f7feaa2728': "Peso atual (kg)",
    'anam.80ee53f0ef': "Altura (cm)",
    'anam.4651e8843c': "Profissão / Ocupação",
    'anam.f6b32d6786': "WhatsApp para contato",
    'anam.8040f51044': "Nível de atividade no trabalho",
    'anam.450040215f': "Tempo de experiência com exercícios",
    'anam.3da77dcc0f': "Carga aproximada no Supino (kg) <span style=\"font-weight:400;color:var(--mu)\">(pode chutar, opcional)</span>",
    'anam.7ba7859ca5': "Carga aproximada no Agachamento (kg) <span style=\"font-weight:400;color:var(--mu)\">(pode chutar, opcional)</span>",
    'anam.de94aee5ba': "Dias disponíveis por semana",
    'anam.e3894e0d38': "Duração disponível por sessão",
    'anam.620f13d953': "Local de treino",
    'anam.59ad7c9279': "Objetivos <span style=\"font-weight:400;color:var(--mu)\">(selecione todos que se aplicam)</span>",
    'anam.7d81e97b0e': "Meta de corrida <span style=\"font-weight:400;color:var(--mu)\">(pode marcar mais de uma)</span>",
    'anam.b3d352b070': "Se você pratica corrida, qual seu nível nela? <span style=\"font-weight:400;color:var(--mu)\">(pode ser diferente do nível na musculação)</span>",
    'anam.176129adf1': "Qual seu ritmo confortável atual de corrida? <span style=\"font-weight:400;color:var(--mu)\">(opcional — deixe em branco se não sabe)</span>",
    'anam.40427e7c67': "Prazo desejado para atingir o objetivo",
    'anam.528ca04324': "O que te motiva a treinar? (escreva livremente)",
    'anam.79d8fc6d21': "Condições de saúde diagnosticadas",
    'anam.65bc976c5f': "Medicamentos de uso contínuo?",
    'anam.251bee014c': "Se sim, quais medicamentos?",
    'anam.cb285306ea': "Histórico de cirurgias",
    'anam.7b7b73e84a': "Pratica ou praticou atividade física regularmente nos últimos 6 meses?",
    'anam.f1c0c67470': "Possui dor ou lesão em alguma região?",
    'anam.0352e48a08': "Intensidade da dor (se houver) — escala de 0 a 10",
    'anam.7e66a34621': "Há quanto tempo sente essa dor/lesão?",
    'anam.6636c1620d': "Como você descreve seu biótipo atual?",
    'anam.13cdca0624': "Onde você acumula mais gordura?",
    'anam.2ef53f3e8d': "Parte do corpo que quer focar no treino",
    'anam.863c134643': "Algum exercício que prefere evitar? <span style=\"font-weight:400;color:var(--mu)\">(opcional, separe por vírgula)</span>",
    'anam.dd1de83ca4': "Suplementação atual",
    'anam.139888d11f': "Horas de sono por noite",
    'anam.1313b513eb': "Nível de estresse diário",
    'anam.6c495e0ab2': "Qualidade da alimentação",
    'anam.7e3fe3c227': "🪑 Sentado o dia todo",
    'anam.d4acba965f': "🚶 Caminha pouco",
    'anam.623b5374ee': "🏃 Em pé/andando",
    'anam.4267a908e7': "⚒️ Trabalho físico",
    'anam.1f571c8163': "🌱 Nunca treinei",
    'anam.2204c2b4d6': "2x",
    'anam.c68ebab7a1': "3x",
    'anam.7d2ec3b03b': "4x",
    'anam.97e2f596ff': "5x",
    'anam.c3caf6ae11': "6x",
    'anam.c726fae3da': "30–45 min",
    'anam.54d5f4f21e': "45–60 min",
    'anam.a31da68b34': "60–90 min",
    'anam.f6d1b4ee84': "90–120 min",
    'anam.66ea76c409': "🏢 Academia completa",
    'anam.aa87c3d75b': "🏋️ Academia básica",
    'anam.1454cfa15d': "🏠 Casa c/ equip.",
    'anam.ddb7833be9': "🏠 Casa s/ equip.",
    'anam.564ea47079': "🛤️ Rua/Pista",
    'anam.4c5b4e39ce': "Não corro",
    'anam.ad1b55928d': "1–2 meses",
    'anam.ab52188dd9': "3–6 meses",
    'anam.ee27302273': "6–12 meses",
    'anam.e3141a4627': "+1 ano",
    'anam.1f5bf413ca': "Sem prazo",
    'anam.b231909af1': "Não",
    'anam.cbb5486e85': "Sim",
    'anam.943fe40a26': "❌ Não, sedentário",
    'anam.dc01e60599': "🔄 Às vezes",
    'anam.1f81da69e8': "✅ 1–2x/semana",
    'anam.fd760e415e': "✅ 3–4x/semana",
    'anam.d9f9677c0a': "✅ 5+x/semana",
    'anam.c38992c679': "Sem dor",
    'anam.ac1fa8d456': "Não tenho",
    'anam.be6fb05cd9': "-1 mês",
    'anam.edf3869429': "1–6m",
    'anam.47b5b84c83': "6–12m",
    'anam.6ea0f46280': "🔄 Misto",
    'anam.80e4e4a853': "🍎 Barriga",
    'anam.316dd118f3': "🍐 Glúteos/Coxas",
    'anam.a3057d953b': "🔄 Distribuído",
    'anam.1a07354842': "✅ Não tenho",
    'anam.cb8e262bd0': "Menos de 5h",
    'anam.055c415668': "5–6h",
    'anam.cc8c7d9519': "7–8h",
    'anam.e00523125c': "Mais de 8h",
    'anam.1f7740d5bc': "😌 Baixo",
    'anam.8a599bf19c': "😐 Moderado",
    'anam.30a5720c34': "😰 Alto",
    'anam.958e3dd502': "😤 Muito alto",
    'anam.2bb3d1b3b7': "😔 Muito ruim",
    'anam.84e4da8d34': "😐 Regular",
    'anam.2011eeaea4': "😊 Boa",
    'anam.28bfb23706': "🤩 Ótima",
    'anam.34541cccb0': "💪 Hipertrofia — ganho de massa muscular",
    'anam.06f6407fb8': "🔥 Emagrecimento — perda de gordura",
    'anam.acc428d57f': "❤️ Condicionamento físico geral",
    'anam.8ad95a0699': "⚡ Força e potência",
    'anam.99d09b088d': "🏃 Resistência e endurance",
    'anam.231ef3aa91': "🌿 Saúde e qualidade de vida",
    'anam.680183fb21': "🩺 Reabilitação e fortalecimento",
    'anam.fa95fc4339': "🏆 Preparo para competição",
    'anam.f0c3cf4920': "🧍 Melhorar postura",
    'anam.66cc87bc9e': "🧠 Reduzir estresse e ansiedade",
    'anam.993fb364e2': "🚫 Não pratico corrida",
    'anam.19d87865d0': "🏃 Completar 5 km",
    'anam.c1ef4c1421': "🏃 Completar 10 km",
    'anam.8fcd391a0b': "🏅 Meia maratona (21 km)",
    'anam.0a5af4cec7': "🏆 Maratona (42 km)",
    'anam.df19338074': "⚡ Melhorar pace / velocidade",
    'anam.fe6ce781a9': "🩺 Correr sem dor ou lesão",
    'anam.8bd8f172f0': "Hipertensão arterial",
    'anam.eec40977f4': "Diabetes (tipo 1 ou 2)",
    'anam.d8841c8a55': "Problemas cardíacos",
    'anam.8030e6c86b': "Colesterol / Triglicerídeos altos",
    'anam.9ae7e3b7eb': "Obesidade (IMC > 30)",
    'anam.9600875e49': "Problemas de tireoide",
    'anam.b80fa8269e': "Osteoporose / Osteopenia",
    'anam.2f9157dcbb': "Ansiedade / Depressão",
    'anam.2cc9d1e1f5': "✅ Nenhuma das anteriores",
    'anam.02aad486d7': "🦵 Joelho — Dor na frente (possível condromalácia)",
    'anam.b594103d4d': "🦵 Joelho — Dor lateral ou posterior",
    'anam.867ace186b': "🔵 Lombar — Dor nas costas baixas",
    'anam.6241386e9f': "🔵 Cervical — Dor no pescoço",
    'anam.9a364204b4': "💪 Ombro direito",
    'anam.ae0182bf21': "💪 Ombro esquerdo",
    'anam.bfd411a2a5': "💪 Cotovelo / Antebraço",
    'anam.635b76ad5f': "🤚 Punho / Mão",
    'anam.2222af0e4c': "🦴 Quadril",
    'anam.8bdfac82f2': "🦶 Tornozelo / Pé",
    'anam.3cfc7cb1b6': "🔵 Hérnia de disco",
    'anam.5d61dd7519': "✅ Nenhuma dor ou lesão",
    'anam.7d43c4d6ee': "Abdômen / Core",
    'anam.979f06e771': "Glúteos",
    'anam.d536970897': "Pernas (coxas e panturrilhas)",
    'anam.729a7b8d0a': "Costas e ombros (forma V)",
    'anam.6a614d6612': "Peito",
    'anam.2e1d815150': "Braços (bíceps e tríceps)",
    'anam.120e3e0a1c': "✅ Corpo todo equilibrado",
    'anam.5286df5820': "Whey protein",
    'anam.00dfc1367f': "Creatina",
    'anam.a5bf67b64c': "Pré-treino / cafeína",
    'anam.37fd8bf028': "BCAA",
    'anam.edd733c688': "Colágeno",
    'anam.63f5283532': "Vitaminas / Minerais",
    'anam.4b8addfeca': "✅ Não uso suplementos",

    // ── Banner de teste ──
    'trial.days': '{n} dias de teste grátis',
    'trial.lastday': 'Último dia grátis!',
    'trial.after': 'Depois, a partir de {preco}/mês para continuar',
    'trial.subscribe': 'Assinar',
  },

  en: {
    // ── Splash ──
    'splash.tagline': 'Rennan Dias Coaching',
    'splash.title': 'Your training.<br>Your <span class="hl">progress.</span><br>Your pace.',
    'splash.sub': 'Sports coaching platform with personalized training plans and full progress tracking.',
    'splash.cta': '▶ Try {dias} days free',
    'splash.login': 'I already have an account',
    'splash.nocard': '✅ No card required · no auto-renewal',

    // ── Autenticação ──
    'auth.tab.login': 'Sign in',
    'auth.tab.register': 'Sign up',
    'auth.title.login': 'Sign in to your account',
    'auth.title.register': 'Create your free account',
    'auth.trial.badge': '🎁 {dias} days free · no credit card',
    'auth.field.name': 'Full name',
    'auth.field.email': 'Email',
    'auth.field.pass': 'Password',
    'auth.field.pass2': 'Confirm password',
    'auth.btn.login': 'Sign in',
    'auth.btn.register': 'Start my {dias} free days',
    'auth.forgot': 'Forgot my password',

    // ── Navegação ──
    'nav.home': 'Home',
    'nav.train': 'Train',
    'nav.store': 'Store',
    'nav.coach': 'Coach',
    'nav.social': 'Social',
    'nav.profile': 'Profile',

    // ── Planos / assinatura ──
    'plan.monthly': 'Monthly',
    'plan.annual': 'Annual',
    'plan.mostchosen': 'MOST POPULAR',
    'plan.permonth': '/mo',
    'plan.monthly.note': 'Billed monthly',
    'plan.annual.note': 'Save 34% · R$118.80 (up to 12x)',
    'plan.subscribe': 'Subscribe {plano}',
    'plan.expired.title': 'Your {dias} days are over, {nome}',
    'plan.expired.sub': 'Keep your personalized strength and running plans,<br/>the Mission Journeys, e-books and the full community.',
    'plan.logout': 'Sign out',
    'plan.benefit1': '✅ Tailored strength & running plans',
    'plan.benefit2': '✅ Journey with 60 gamified missions',
    'plan.benefit3': '✅ Periodized running plan',
    'plan.benefit4': '✅ Community and leaderboard',
    'plan.benefit5': '✅ Progress tracking',

    // ── Anamnese (estrutura) ──
    'anam.stepcount': 'Step {n} of {total}',
    'anam.building': 'Building your program',
    'anam.hdr.title': "📋 Full Assessment",
    'anam.hdr.sub': "The more details, the more precise your plan will be!",
    'anam.sec.1': "👤 Personal Info",
    'anam.sec.2': "🏋️ Training Experience",
    'anam.sec.3': "🎯 Goals",
    'anam.sec.4': "❤️ Health History",
    'anam.sec.5': "🩺 Injuries & Limitations",
    'anam.sec.6': "📊 Body Composition",
    'anam.sec.7': "🌙 Lifestyle & Recovery",
    'anam.btn.back': "← Back",
    'anam.btn.next': "Next step →",
    'anam.sel.placeholder': "Select",
    'anam.sel.male': "Male",
    'anam.sel.female': "Female",
    'anam.btn.submit': 'Submit assessment ✅',
    'home.wantgym': 'Create strength plan',
    'home.wantrun': 'Create running plan',
    'anam.g.hdrtitle': "📋 Let's get to know you",
    'anam.g.hdrsub': 'This helps us understand your health and routine — takes under 2 minutes.',
    'anam.g.sec2': '❤️ Health',
    'anam.g.sec3': '🌙 Lifestyle',
    'anam.m.hdrtitle': '🏋️ Your Strength Training',
    'anam.m.hdrsub': 'Just what the engine needs to build your workout right.',
    'anam.m.sec1': '🏋️ Experience & Setup',
    'anam.m.sec2': '🎯 Goals',
    'anam.m.sec3': '🩺 Injuries & Body Composition',
    'anam.c.hdrtitle': '🏃 Your Running Plan',
    'anam.c.hdrsub': 'Quick one — just the essentials to build your running plan.',
    'anam.c.sec1': '🏃 Your Running',
    'anam.c.sec2': '🩺 Injuries',
    'home.wantgym.sub': 'Answer 3 quick steps',
    'home.wantrun.sub': 'Just 2 steps — very quick',
    'home.addplan': '➕ Add to your plan',
    // ── Anamnese ──
    'anam.71ef84890d': "Date of birth",
    'anam.5c7d7a110a': "Biological sex",
    'anam.f7feaa2728': "Current weight (kg)",
    'anam.80ee53f0ef': "Height (cm)",
    'anam.4651e8843c': "Occupation",
    'anam.f6b32d6786': "WhatsApp for contact",
    'anam.8040f51044': "Activity level at work",
    'anam.450040215f': "Training experience",
    'anam.3da77dcc0f': "Approximate Bench Press load (kg) <span style=\"font-weight:400;color:var(--mu)\">(rough guess is fine, optional)</span>",
    'anam.7ba7859ca5': "Approximate Squat load (kg) <span style=\"font-weight:400;color:var(--mu)\">(rough guess is fine, optional)</span>",
    'anam.de94aee5ba': "Days available per week",
    'anam.e3894e0d38': "Time available per session",
    'anam.620f13d953': "Where you train",
    'anam.59ad7c9279': "Goals <span style=\"font-weight:400;color:var(--mu)\">(select all that apply)</span>",
    'anam.7d81e97b0e': "Running goal <span style=\"font-weight:400;color:var(--mu)\">(you can select more than one)</span>",
    'anam.b3d352b070': "If you run, what is your running level? <span style=\"font-weight:400;color:var(--mu)\">(may differ from your strength level)</span>",
    'anam.176129adf1': "Your current comfortable running pace? <span style=\"font-weight:400;color:var(--mu)\">(optional — leave blank if unsure)</span>",
    'anam.40427e7c67': "Target timeframe for your goal",
    'anam.528ca04324': "What motivates you to train? (write freely)",
    'anam.79d8fc6d21': "Diagnosed health conditions",
    'anam.65bc976c5f': "Do you take medication regularly?",
    'anam.251bee014c': "If yes, which medications?",
    'anam.cb285306ea': "Surgery history",
    'anam.7b7b73e84a': "Have you exercised regularly in the last 6 months?",
    'anam.f1c0c67470': "Do you have pain or injury anywhere?",
    'anam.0352e48a08': "Pain intensity (if any) — scale of 0 to 10",
    'anam.7e66a34621': "How long have you had this pain/injury?",
    'anam.6636c1620d': "How would you describe your current body type?",
    'anam.13cdca0624': "Where do you store the most fat?",
    'anam.2ef53f3e8d': "Body area you want to focus on",
    'anam.863c134643': "Any exercise you prefer to avoid? <span style=\"font-weight:400;color:var(--mu)\">(optional, separate with commas)</span>",
    'anam.dd1de83ca4': "Current supplements",
    'anam.139888d11f': "Hours of sleep per night",
    'anam.1313b513eb': "Daily stress level",
    'anam.6c495e0ab2': "Diet quality",
    'anam.7e3fe3c227': "🪑 Seated all day",
    'anam.d4acba965f': "🚶 Walk a little",
    'anam.623b5374ee': "🏃 Standing/walking",
    'anam.4267a908e7': "⚒️ Physical labor",
    'anam.1f571c8163': "🌱 Never trained",
    'anam.2204c2b4d6': "2x",
    'anam.c68ebab7a1': "3x",
    'anam.7d2ec3b03b': "4x",
    'anam.97e2f596ff': "5x",
    'anam.c3caf6ae11': "6x",
    'anam.c726fae3da': "30–45 min",
    'anam.54d5f4f21e': "45–60 min",
    'anam.a31da68b34': "60–90 min",
    'anam.f6d1b4ee84': "90–120 min",
    'anam.66ea76c409': "🏢 Full gym",
    'anam.aa87c3d75b': "🏋️ Basic gym",
    'anam.1454cfa15d': "🏠 Home w/ equip.",
    'anam.ddb7833be9': "🏠 Home no equip.",
    'anam.564ea47079': "🛤️ Street/Track",
    'anam.4c5b4e39ce': "I don't run",
    'anam.ad1b55928d': "1–2 months",
    'anam.ab52188dd9': "3–6 months",
    'anam.ee27302273': "6–12 months",
    'anam.e3141a4627': "+1 year",
    'anam.1f5bf413ca': "No deadline",
    'anam.b231909af1': "No",
    'anam.cbb5486e85': "Yes",
    'anam.943fe40a26': "❌ No, sedentary",
    'anam.dc01e60599': "🔄 Sometimes",
    'anam.1f81da69e8': "✅ 1–2x/week",
    'anam.fd760e415e': "✅ 3–4x/week",
    'anam.d9f9677c0a': "✅ 5+x/week",
    'anam.c38992c679': "No pain",
    'anam.ac1fa8d456': "None",
    'anam.be6fb05cd9': "-1 month",
    'anam.edf3869429': "1–6m",
    'anam.47b5b84c83': "6–12m",
    'anam.6ea0f46280': "🔄 Mixed",
    'anam.80e4e4a853': "🍎 Belly",
    'anam.316dd118f3': "🍐 Glutes/Thighs",
    'anam.a3057d953b': "🔄 Evenly spread",
    'anam.1a07354842': "✅ I have none",
    'anam.cb8e262bd0': "Less than 5h",
    'anam.055c415668': "5–6h",
    'anam.cc8c7d9519': "7–8h",
    'anam.e00523125c': "More than 8h",
    'anam.1f7740d5bc': "😌 Low",
    'anam.8a599bf19c': "😐 Moderate",
    'anam.30a5720c34': "😰 High",
    'anam.958e3dd502': "😤 Very high",
    'anam.2bb3d1b3b7': "😔 Very poor",
    'anam.84e4da8d34': "😐 Average",
    'anam.2011eeaea4': "😊 Good",
    'anam.28bfb23706': "🤩 Excellent",
    'anam.34541cccb0': "💪 Hypertrophy — muscle gain",
    'anam.06f6407fb8': "🔥 Weight loss — fat loss",
    'anam.acc428d57f': "❤️ General fitness",
    'anam.8ad95a0699': "⚡ Strength and power",
    'anam.99d09b088d': "🏃 Stamina and endurance",
    'anam.231ef3aa91': "🌿 Health and quality of life",
    'anam.680183fb21': "🩺 Rehab and strengthening",
    'anam.fa95fc4339': "🏆 Competition prep",
    'anam.f0c3cf4920': "🧍 Improve posture",
    'anam.66cc87bc9e': "🧠 Reduce stress and anxiety",
    'anam.993fb364e2': "🚫 I don't run",
    'anam.19d87865d0': "🏃 Complete a 5K",
    'anam.c1ef4c1421': "🏃 Complete a 10K",
    'anam.8fcd391a0b': "🏅 Half marathon (21K)",
    'anam.0a5af4cec7': "🏆 Marathon (42K)",
    'anam.df19338074': "⚡ Improve pace / speed",
    'anam.fe6ce781a9': "🩺 Run without pain or injury",
    'anam.8bd8f172f0': "High blood pressure",
    'anam.eec40977f4': "Diabetes (type 1 or 2)",
    'anam.d8841c8a55': "Heart conditions",
    'anam.8030e6c86b': "High cholesterol / triglycerides",
    'anam.9ae7e3b7eb': "Obesity (BMI > 30)",
    'anam.9600875e49': "Thyroid conditions",
    'anam.b80fa8269e': "Osteoporosis / Osteopenia",
    'anam.2f9157dcbb': "Anxiety / Depression",
    'anam.2cc9d1e1f5': "✅ None of the above",
    'anam.02aad486d7': "🦵 Knee — front pain (possible chondromalacia)",
    'anam.b594103d4d': "🦵 Knee — side or back pain",
    'anam.867ace186b': "🔵 Lower back pain",
    'anam.6241386e9f': "🔵 Neck pain",
    'anam.9a364204b4': "💪 Right shoulder",
    'anam.ae0182bf21': "💪 Left shoulder",
    'anam.bfd411a2a5': "💪 Elbow / Forearm",
    'anam.635b76ad5f': "🤚 Wrist / Hand",
    'anam.2222af0e4c': "🦴 Hip",
    'anam.8bdfac82f2': "🦶 Ankle / Foot",
    'anam.3cfc7cb1b6': "🔵 Herniated disc",
    'anam.5d61dd7519': "✅ No pain or injury",
    'anam.7d43c4d6ee': "Abs / Core",
    'anam.979f06e771': "Glutes",
    'anam.d536970897': "Legs (thighs and calves)",
    'anam.729a7b8d0a': "Back and shoulders (V-shape)",
    'anam.6a614d6612': "Chest",
    'anam.2e1d815150': "Arms (biceps and triceps)",
    'anam.120e3e0a1c': "✅ Balanced full body",
    'anam.5286df5820': "Whey protein",
    'anam.00dfc1367f': "Creatine",
    'anam.a5bf67b64c': "Pre-workout / caffeine",
    'anam.37fd8bf028': "BCAA",
    'anam.edd733c688': "Collagen",
    'anam.63f5283532': "Vitamins / Minerals",
    'anam.4b8addfeca': "✅ I don't take supplements",

    // ── Banner de teste ──
    'trial.days': '{n} days left in your free trial',
    'trial.lastday': 'Last free day!',
    'trial.after': 'After that, from {preco}/mo to continue',
    'trial.subscribe': 'Subscribe',
  }
};

// ══ HISTORY ══
function renderHistory(u){
  const hist=(u.workoutHistory||[]).slice(-6).reverse();
  const el=document.getElementById('history-carousel');
  if(!hist.length){el.innerHTML='<div style="padding:0 20px;font-size:12px;color:var(--mu)">Nenhum treino ainda. Bora começar! 🎬</div>';return;}
  el.innerHTML=hist.map(h=>`<div class="cw-card" style="width:220px">
    <div class="cw-thumb" style="height:100px;background:#000;padding:0;overflow:hidden">
    <img src="${h.exercises?.[0]?'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&q=80':'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=600&q=80'}" alt="Treino" style="width:100%;height:100%;object-fit:cover;filter:brightness(.6)"/>
  </div>
    <div class="cw-body">
      <div class="cw-title">${h.day}</div>
      <div class="cw-sub">${h.date} · ${h.week}</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${(h.exercises||[]).slice(0,2).map(e=>`<span style="background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.15);border-radius:4px;padding:2px 7px;font-size:9px;font-weight:700;color:var(--r)">${e.name}</span>`).join('')}</div>
    </div>
  </div>`).join('');
}

// ══ MISSIONS ══
function renderMissions(ms){
  const tc={gym:'var(--r)',run:'#2ecc71',week:'#3498db',pr:'#f39c12'};
  const ti={gym:'🏋️',run:'🏃',week:'📅',pr:'⭐'};
  // Dias restantes da semana
  const hoje=new Date();const diasRestantes=7-(hoje.getDay()===0?7:hoje.getDay());
  const h=m=>{const pct=Math.min((m.progress/m.total)*100,100);const c=tc[m.type]||'var(--r)';return `<div style="background:var(--s);border:1px solid var(--b);border-radius:8px;padding:14px;margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:${!m.done?'10':'0'}px"><div style="display:flex;gap:10px;align-items:center"><span style="font-size:16px">${ti[m.type]||'🎯'}</span><div><div style="font-size:13px;font-weight:700">${m.title}${m.semanal?' <span style=\"font-size:8px;background:rgba(52,152,219,.15);color:#3498db;border-radius:3px;padding:1px 5px;font-weight:900;vertical-align:middle\">SEMANAL</span>':''}</div><div style="font-size:10px;color:var(--t2);margin-top:2px">${m.done?'✅ Concluída!':m.progress+' / '+m.total}</div></div></div><div style="background:${c}20;border:1px solid ${c}40;border-radius:4px;padding:3px 9px;font-size:10px;font-weight:800;color:${c}">+${m.xp}XP</div></div>${!m.done?`<div style="background:rgba(255,255,255,.08);border-radius:99px;height:3px;overflow:hidden"><div style="width:${pct}%;height:100%;border-radius:99px;background:${c}"></div></div>`:''}</div>`;};
  document.getElementById('home-missions').innerHTML=ms.filter(m=>!m.done).slice(0,2).map(h).join('')||'<div style="font-size:12px;color:var(--mu)">Nenhuma missão ativa 🎉</div>';
}

// ══ PERFIL ══
function renderPerfil(u){
  // Basic info
  const pnEl=document.getElementById('perfil-name');if(pnEl)pnEl.textContent=u.name||'Atleta';
  const peEl=document.getElementById('perfil-email-disp');if(peEl)peEl.textContent=u.email||'';
  // Stats
  const ptEl=document.getElementById('perfil-treinos');if(ptEl)ptEl.textContent=u.stats?.treinos||0;
  const pkEl=document.getElementById('perfil-km');if(pkEl)pkEl.textContent=u.stats?.distancia||0;
  const psEl=document.getElementById('perfil-streak');if(psEl)psEl.textContent=(u.streak||1)+streakFlame(u.streak||1);
  // Level/XP
  const plEl=document.getElementById('perfil-lv');if(plEl)plEl.textContent=u.level||1;
  const pcEl=document.getElementById('perfil-coins');if(pcEl)pcEl.textContent=u.coins||0;
  const xpN=(u.level||1)*1000;
  const pxEl=document.getElementById('perfil-xp');if(pxEl)pxEl.textContent=(u.xp||0).toLocaleString()+' XP';
  const pxnEl=document.getElementById('perfil-xpn');if(pxnEl)pxnEl.textContent=xpN.toLocaleString()+' XP';
  const pxbEl=document.getElementById('perfil-xpbar');if(pxbEl)pxbEl.style.width=Math.min(((u.xp||0)/xpN)*100,100)+'%';
  // Avatar via updateAvatarDisplays
  updateAvatarDisplays(u);
  // Badges row
  const br=document.getElementById('perfil-badges-row');
  if(br){
    const earned=BADGES.filter(b=>(u.badges||[]).includes(b.id));
    if(earned.length){
      br.innerHTML=earned.map(b=>`<div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.15);border-radius:10px;padding:10px 12px;text-align:center;flex-shrink:0"><div style="font-size:24px">${b.icon}</div><div style="font-size:9px;font-weight:700;color:var(--t2);margin-top:3px;white-space:nowrap">${b.name}</div></div>`).join('');
    } else {
      br.innerHTML='<div style="font-size:12px;color:var(--mu)">Nenhuma conquista ainda. Continue treinando! 💪</div>';
    }
  }
}

// ══ RANKING (dados reais do banco) ══
function montarListaRanking(u,email){
  const me={name:(u.name||'Você').split(' ')[0],xp:u.xp||0,level:u.level||1,isMe:true};
  const outros=RANKING_CACHE.filter(r=>r.name&&!(r.name===me.name&&r.xp===me.xp));
  const combined=[me,...outros].sort((a,b)=>b.xp-a.xp);
  const seen=new Set();
  return combined.filter(r=>{const k=r.name+'|'+r.xp;if(seen.has(k))return false;seen.add(k);return true;});
}
function renderRankingCarousel(u,email,users){
  const uniq=montarListaRanking(u,email).slice(0,10);
  document.getElementById('ranking-carousel').innerHTML=uniq.map((r,i)=>`<div class="rk-card">
    <div class="rk-card-num">${i+1}</div>
    <div class="rk-card-info">
      <div class="rk-card-av" style="${r.isMe?'box-shadow:0 0 0 2px #fff':''};">${r.name?r.name[0].toUpperCase():'?'}</div>
      <div class="rk-card-name" style="color:${r.isMe?'var(--r)':'var(--t)'}">${r.name}${r.isMe?' ★':''}</div>
      <div class="rk-card-xp">${(r.xp||0).toLocaleString()} XP · Nv${r.level}</div>
    </div>
  </div>`).join('');
}

// ══ RANKING FULL ══
function renderRankingFull(u,email,users){
  const uniq=montarListaRanking(u,email);
  const medals=['🥇','🥈','🥉'];const myPos=uniq.findIndex(r=>r.isMe)+1;
  document.getElementById('my-rank').textContent=myPos||'–';
  // ══ PÓDIO TOP 3 ══
  const pod=document.getElementById('ranking-podium');
  if(pod){
    const t=[uniq[1],uniq[0],uniq[2]]; // 2º, 1º, 3º (visual de pódio)
    const hs=[74,96,58];const cs=['#c0c0c0','#f39c12','#cd7f32'];const ms=['🥈','🥇','🥉'];
    pod.innerHTML=t.map((r,i)=>{
      if(!r)return '<div style="width:88px"></div>';
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;width:88px">
        <div style="font-size:20px">${ms[i]}</div>
        <div style="width:52px;height:52px;border-radius:50%;background:${r.isMe?'var(--r)':'var(--s2)'};border:2.5px solid ${cs[i]};display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;color:#fff">${r.name?r.name[0].toUpperCase():'?'}</div>
        <div style="font-size:11px;font-weight:800;color:${r.isMe?'var(--r)':'var(--t)'};max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}${r.isMe?' ★':''}</div>
        <div style="background:linear-gradient(180deg,${cs[i]}33,${cs[i]}11);border:1px solid ${cs[i]}55;border-radius:8px 8px 0 0;width:100%;height:${hs[i]}px;display:flex;flex-direction:column;align-items:center;justify-content:center">
          <div style="font-size:14px;font-weight:900;color:${cs[i]}">${(r.xp||0).toLocaleString()}</div>
          <div style="font-size:8px;color:var(--mu);font-weight:700">XP</div>
        </div>
      </div>`;
    }).join('');
  }
  document.getElementById('ranking-full').innerHTML=uniq.slice(3).map((r,i)=>{const p=i+4;return `<div class="rank-row" style="background:${r.isMe?'rgba(229,9,20,.08)':'var(--s)'};border:1px solid ${r.isMe?'rgba(229,9,20,.25)':'var(--b)'};border-radius:8px;padding:10px 14px;display:flex;align-items:center;gap:2px;margin:0 20px 8px;overflow:hidden">
    <div style="width:38px;text-align:center;font-size:30px;font-weight:900;font-style:italic;line-height:1;color:${r.isMe?'var(--r)':'transparent'};-webkit-text-stroke:1.4px ${r.isMe?'var(--r)':'var(--b2)'};flex-shrink:0;letter-spacing:-2px">${p}</div>
    <div style="width:36px;height:36px;border-radius:6px;background:${r.isMe?'var(--r)':'var(--s2)'};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:#fff;flex-shrink:0;margin-right:10px">${r.name?r.name[0].toUpperCase():'?'}</div>
    <div style="flex:1;min-width:0"><div style="font-size:12px;font-weight:700;color:${r.isMe?'var(--r)':'var(--t)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.name}${r.isMe?' <span style="font-size:9px;color:var(--mu)">(você)</span>':''}</div><div style="font-size:10px;color:var(--mu)">Nível ${r.level}</div></div>
    <div style="text-align:right;flex-shrink:0"><div style="font-size:13px;font-weight:800;color:${r.isMe?'var(--r)':'var(--t)'}">${(r.xp||0).toLocaleString()}</div><div style="font-size:9px;color:var(--mu)">XP</div></div>
  </div>`;}).join('');
}

// ══ BADGES ══
function renderBadges(earned){
  const s=new Set(earned);const e=BADGES.filter(b=>s.has(b.id)),l=BADGES.filter(b=>!s.has(b.id));
  const card=(b,isE)=>`<div class="bcard ${isE?'earned':'locked'}"><div class="bico">${b.icon}</div><div class="bnm">${b.name}</div></div>`;
  document.getElementById('badges-earned').innerHTML=e.map(b=>card(b,true)).join('')||'<div style="color:var(--mu);font-size:12px">Nenhuma ainda!</div>';
  document.getElementById('badges-locked').innerHTML=l.map(b=>card(b,false)).join('');
  document.getElementById('badges-count').textContent=`${e.length}/${BADGES.length}`;
  const bc2=document.getElementById('badges-count-2');if(bc2)bc2.textContent=document.getElementById('badges-count').textContent;
  document.getElementById('badges-bar').style.width=(e.length/BADGES.length*100)+'%';
}

// ══ NAV ══
// ══════════════════════════════════════════════════════════
// HISTÓRICO DE NAVEGAÇÃO — corrige o botão Voltar do navegador/celular.
// Sem isso, nenhuma troca de aba ou abertura de modal ficava registrada
// no histórico, então "Voltar" tentava sair do app inteiro em vez de
// fechar o modal atual ou voltar pra aba anterior.
// ══════════════════════════════════════════════════════════

function _pushNavState(label){
  try{ history.pushState({fqNav:true, label:label, t:Date.now()}, '', location.pathname+location.search); }
  catch(e){ /* navegador sem suporte a History API — degrada graciosamente */ }
}

function abrirModal(modalId){
  const el = document.getElementById(modalId);
  if(!el) return;
  el.classList.add('open');
  _pushNavState('modal:'+modalId);
}

window.addEventListener('popstate', function(){
  // Se este "voltar" foi disparado pelo próprio código só pra limpar a entrada
  // de histórico de um modal recém-fechado, não faz nada — senão o app navegaria
  // pra Home sem o usuário ter pedido.
  if(_fqConsumindoHistorico){ _fqConsumindoHistorico=false; return; }
  _fqNavegandoViaVoltar = true;
  // Prioridade 1: se houver um modal aberto, o Voltar fecha ELE (não a tela toda)
  const modalAberto = document.querySelector('.modal-ov.open, [id^="modal-"].open');
  if(modalAberto){
    if(modalAberto.id==='modal-ebook') closeEbook();
    else closeModal(modalAberto.id);
    _fqNavegandoViaVoltar = false;
    return;
  }
  // Prioridade 2: na tela de login/cadastro, o Voltar leva de volta pro site institucional
  const scAuth = document.getElementById('sc-auth');
  if(scAuth && scAuth.classList.contains('active')){
    window.location.href = 'https://rennandias.com.br';
    return;
  }
  // Prioridade 3: dentro do app, se não estiver na Home, o Voltar leva pra Home
  const scApp = document.getElementById('sc-app');
  if(scApp && scApp.classList.contains('active')){
    const abaAtiva = document.querySelector('.tp.active');
    if(abaAtiva && abaAtiva.id!=='tp-home'){
      const btnHome = document.querySelectorAll('.nbtn')[0];
      switchTab('home', btnHome);
      _fqNavegandoViaVoltar = false;
      return;
    }
  }
  _fqNavegandoViaVoltar = false;
  // Caso contrário: deixa o navegador seguir o padrão dele (sair do app/PWA)
});

// ══ BOTÃO VOLTAR (barra superior) ══
// Aparece em qualquer aba que não seja a Home e leva de volta pra ela.
// Assim o aluno nunca precisa usar o botão do navegador pra navegar no app.
function voltarParaHome(){
  const btnHome = document.querySelectorAll('.nbtn')[0];
  switchTab('home', btnHome);
}
function atualizarBotaoVoltar(){
  const btn = document.getElementById('nav-back');
  if(!btn) return;
  const abaAtiva = document.querySelector('.tp.active');
  const naHome = !abaAtiva || abaAtiva.id === 'tp-home';
  btn.style.display = naHome ? 'none' : 'flex';
}

function switchTab(name,btn){
  document.querySelectorAll('.tp').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nbtn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tp-'+name).classList.add('active');
  if(btn)btn.classList.add('active');
  window.scrollTo(0,0);
  // Home é a "raiz" da navegação — só registra no histórico quando sai dela,
  // assim o botão Voltar sempre retorna pra Home antes de tentar sair do app.
  if(name!=='home') _pushNavState('tab:'+name);
  try{ atualizarBotaoVoltar(); }catch(e){}
  document.getElementById('nav-menu').classList.remove('open');
  // Na aba perfil: navbar transparente para não tampar a foto
  const nav=document.getElementById('app-nav');
  if(nav){
    if(name==='perfil'){
      nav.style.cssText='background:transparent!important;border-bottom:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;';
    } else {
      nav.style.cssText='';
    }
  }
  if(name==='missoes'&&typeof renderMissoes==='function')renderMissoes();
}

// ══ AVATAR SYSTEM ══
let avState = {photoData:null, color:'#e50914'};

function openAvatarModal(){
  const u = getU();
  if(u?.avatar){
    avState.photoData = u.avatar.photoData||null;
    avState.color     = u.avatar.color||'#e50914';
  }
  // Set preview
  updateAvPreview(u?.name||'?');
  // Restore color selection
  document.querySelectorAll('.av-color').forEach(el=>{
    const sel = el.dataset.color===avState.color;
    el.style.boxShadow = sel ? `0 0 0 3px ${avState.color}` : 'none';
    el.style.border    = sel ? '3px solid #fff' : '3px solid transparent';
  });
  // Show/hide remove button
  document.getElementById('btn-remove-photo').style.display = avState.photoData ? 'block' : 'none';
  abrirModal('modal-avatar');
}

function updateAvPreview(name){
  const prev = document.getElementById('av-preview');
  const ini  = document.getElementById('av-preview-ini');
  if(!prev) return;
  const letter = name ? name[0].toUpperCase() : '?';
  if(avState.photoData){
    prev.innerHTML = `<img src="${avState.photoData}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`;
    prev.style.background = '#000';
    document.getElementById('btn-remove-photo').style.display='block';
  } else {
    prev.innerHTML = `<span id="av-preview-ini" style="font-size:42px;font-weight:900;color:#fff">${letter}</span>`;
    prev.style.background = avState.color;
    document.getElementById('btn-remove-photo').style.display='none';
  }
}

function selColor(el){
  document.querySelectorAll('.av-color').forEach(o=>{
    o.style.boxShadow='none';
    o.style.border='3px solid transparent';
  });
  el.style.boxShadow = `0 0 0 3px ${el.dataset.color}`;
  el.style.border = '3px solid #fff';
  avState.color = el.dataset.color;
  avState.photoData = null;
  const u = getU();
  updateAvPreview(u?.name||'?');
}

function handlePhotoUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  if(file.size > 5*1024*1024){ fqToast('Foto muito grande! Máximo 5MB.','warn'); return; }
  const reader = new FileReader();
  reader.onload = ev=>{
    avState.photoData = ev.target.result;
    const u = getU();
    updateAvPreview(u?.name||'?');
  };
  reader.readAsDataURL(file);
}

function removePhoto(){
  avState.photoData = null;
  const u = getU();
  updateAvPreview(u?.name||'?');
}

function saveAvatar(){
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  if(!users[email]) return;
  users[email].avatar = {...avState};
  DB.set('fq_users', users);
  syncU(users[email]);
  updateAvatarDisplays(users[email]);
  renderPerfil(users[email]);
  closeModal('modal-avatar');
}

function updateAvatarDisplays(u){
  const av    = u.avatar||{};
  const photo = av.photoData||null;
  const color = av.color||'#e50914';
  const letter= u.name?u.name[0].toUpperCase():'?';

  const inner = photo
    ? `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
    : `<span style="font-size:inherit;font-weight:900;color:#fff">${letter}</span>`;

  // Home card
  const homeAv = document.getElementById('home-profile-av');
  if(homeAv){
    homeAv.innerHTML = inner + '<div class="profile-av-badge">✏️</div>';
    homeAv.style.background = photo ? '#000' : color;
    homeAv.onclick = openAvatarModal;
  }
  // Nav avatar
  const navAv = document.getElementById('nav-av');
  if(navAv){
    if(photo){ navAv.innerHTML=`<img src="${photo}" style="width:32px;height:32px;border-radius:4px;object-fit:cover"/>`; navAv.style.background='#000'; }
    else{ navAv.textContent=letter; navAv.style.background=color; }
  }
  // Nav perfil icon
  const navPic = document.getElementById('nav-perfil-ico');
  if(navPic){
    navPic.innerHTML = photo
      ? `<img src="${photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover"/>`
      : letter;
  }
  // Perfil tab main avatar
  const pavEl = document.getElementById('perfil-av-main');
  if(pavEl){
    pavEl.innerHTML = (photo
      ? `<img src="${photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
      : `<span style="font-size:46px;font-weight:900;color:#fff">${letter}</span>`)
      + `<div style="position:absolute;bottom:4px;right:4px;width:28px;height:28px;background:var(--r);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;border:2px solid #0a0a0a">✏️</div>`;
    pavEl.style.background = photo ? '#000' : color;
    pavEl.onclick = openAvatarModal;
  }
}

function getAvatarEmoji(u){ return u?.name?u.name[0].toUpperCase():'?'; }

// ══ EVOLUÇÃO / AVALIAÇÃO CORPORAL ══

let evalMethod = 'pollock';

// Classificação % gordura por sexo e idade
function classifyFat(fat, sex, age){
  // Tabelas baseadas em ACSM
  const isMasc = (sex||'Masculino').toLowerCase().includes('masc');
  let cls, color;
  if(isMasc){
    if(fat < 6)       { cls='Essencial'; color='#3498db'; }
    else if(fat < 14) { cls='✅ Atlético'; color='#2ecc71'; }
    else if(fat < 18) { cls='✅ Boa forma'; color='#2ecc71'; }
    else if(fat < 25) { cls='⚠️ Aceitável'; color='#f39c12'; }
    else if(fat < 30) { cls='⚠️ Sobrepeso'; color='#e67e22'; }
    else              { cls='🔴 Obesidade'; color='#e50914'; }
  } else {
    if(fat < 14)      { cls='Essencial'; color='#3498db'; }
    else if(fat < 21) { cls='✅ Atlético'; color='#2ecc71'; }
    else if(fat < 25) { cls='✅ Boa forma'; color='#2ecc71'; }
    else if(fat < 32) { cls='⚠️ Aceitável'; color='#f39c12'; }
    else if(fat < 38) { cls='⚠️ Sobrepeso'; color='#e67e22'; }
    else              { cls='🔴 Obesidade'; color='#e50914'; }
  }
  return {cls, color};
}

// Pollock 7 dobras — Jackson & Pollock + Siri
function calcPollock7(dobras, idade, sexo, peso){
  const soma = dobras.reduce((a,b)=>a+(parseFloat(b)||0), 0);
  if(soma <= 0 || !idade || !peso) return null;
  const isMasc = (sexo||'Masculino').toLowerCase().includes('masc');
  let dc;
  if(isMasc){
    // Homens: Jackson & Pollock 1978
    dc = 1.112 - (0.00043499*soma) + (0.00000055*soma*soma) - (0.00028826*idade);
  } else {
    // Mulheres: Jackson & Pollock 1980
    dc = 1.097 - (0.00046971*soma) + (0.00000056*soma*soma) - (0.00012828*idade);
  }
  // Equação de Siri
  const fatPct = ((4.95/dc) - 4.50) * 100;
  const fatKg  = (fatPct/100) * peso;
  const leanKg = peso - fatKg;
  return { soma, dc:dc.toFixed(5), fatPct:fatPct.toFixed(1), fatKg:fatKg.toFixed(1), leanKg:leanKg.toFixed(1) };
}

// Calcula em tempo real conforme digita
function calcRealtime(){
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  const u = users[email];
  if(!u) return;

  const dobras = [
    document.getElementById('d-peitoral')?.value||0,
    document.getElementById('d-axilar')?.value||0,
    document.getElementById('d-triceps')?.value||0,
    document.getElementById('d-subescapular')?.value||0,
    document.getElementById('d-abdominal')?.value||0,
    document.getElementById('d-suprailíaca')?.value||0,
    document.getElementById('d-coxa')?.value||0,
  ];
  const peso  = parseFloat(document.getElementById('eval-peso')?.value||0);
  const soma  = dobras.reduce((a,b)=>a+(parseFloat(b)||0),0);
  const idade = u.anamnese?.nasc ? Math.floor((Date.now()-new Date(u.anamnese.nasc))/(365.25*24*3600*1000)) : 30;
  const sexo  = u.anamnese?.sexo || 'Masculino';

  document.getElementById('rt-soma').textContent = soma.toFixed(1);

  if(soma > 0 && peso > 0){
    const r = calcPollock7(dobras, idade, sexo, peso);
    if(r){
      document.getElementById('rt-fat').textContent = r.fatPct+'%';
      document.getElementById('rt-lean').textContent = r.leanKg+'kg';
      const {cls, color} = classifyFat(parseFloat(r.fatPct), sexo, idade);
      const clsEl = document.getElementById('rt-class');
      clsEl.textContent = cls;
      clsEl.style.background = color+'22';
      clsEl.style.color = color;
    }
  } else {
    document.getElementById('rt-fat').textContent = '—';
    document.getElementById('rt-lean').textContent = '—';
  }
}

function calcBio(){
  const fat  = parseFloat(document.getElementById('bio-fat')?.value||0);
  const lean = parseFloat(document.getElementById('bio-lean')?.value||0);
  const peso = parseFloat(document.getElementById('eval-peso')?.value||0);
  if(fat>0){ document.getElementById('bio-rt-fat').textContent = fat.toFixed(1)+'%'; }
  if(lean>0){ document.getElementById('bio-rt-lean').textContent = lean.toFixed(1)+'kg'; }
  if(peso>0 && fat>0){ document.getElementById('bio-rt-gorda').textContent = ((fat/100)*peso).toFixed(1)+'kg'; }
}

// Attach realtime listeners
function attachEvalListeners(){
  const ids = ['d-peitoral','d-axilar','d-triceps','d-subescapular','d-abdominal','d-suprailíaca','d-coxa','eval-peso'];
  ids.forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input', calcRealtime); });
  ['bio-fat','bio-lean'].forEach(id=>{ const el=document.getElementById(id); if(el) el.addEventListener('input', calcBio); });
}

function selMethod(method, el){
  evalMethod = method;
  document.querySelectorAll('.method-tab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('panel-pollock').style.display = method==='pollock'?'block':'none';
  document.getElementById('panel-bio').style.display     = method==='bio'?'block':'none';
}

function openEvalModal(){
  // Set today's date
  const today = new Date().toISOString().split('T')[0];
  const dateEl = document.getElementById('eval-date');
  if(dateEl) dateEl.value = today;
  // Reset fields
  ['d-peitoral','d-axilar','d-triceps','d-subescapular','d-abdominal','d-suprailíaca','d-coxa',
   'bio-fat','bio-lean','bio-water','bio-bone','bio-tmb','bio-idademet','eval-obs'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  // Reset peso from profile
  const u = getU();
  const pesoEl = document.getElementById('eval-peso');
  if(pesoEl && u?.anamnese?.peso) pesoEl.value = u.anamnese.peso;
  // Reset results
  ['rt-soma','rt-fat','rt-lean','bio-rt-fat','bio-rt-lean','bio-rt-gorda'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.textContent='—';
  });
  document.getElementById('rt-soma').textContent='0';
  const clsEl=document.getElementById('rt-class');
  if(clsEl){clsEl.textContent='Preencha as dobras';clsEl.style.background='rgba(255,255,255,.08)';clsEl.style.color='';}
  abrirModal('modal-eval');
  setTimeout(attachEvalListeners, 100);
}

function saveEval(){
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  const u = users[email];
  if(!u) return;

  const date  = document.getElementById('eval-date')?.value;
  const peso  = parseFloat(document.getElementById('eval-peso')?.value||0);
  const obs   = document.getElementById('eval-obs')?.value||'';
  if(!date||!peso){ fqToast('Preencha a data e o peso!','warn'); return; }

  const idade = u.anamnese?.nasc ? Math.floor((Date.now()-new Date(u.anamnese.nasc))/(365.25*24*3600*1000)) : 30;
  const sexo  = u.anamnese?.sexo || 'Masculino';

  let evalData = { id:Date.now(), date, peso, obs, method:evalMethod };

  if(evalMethod === 'pollock'){
    const dobras = [
      parseFloat(document.getElementById('d-peitoral')?.value||0),
      parseFloat(document.getElementById('d-axilar')?.value||0),
      parseFloat(document.getElementById('d-triceps')?.value||0),
      parseFloat(document.getElementById('d-subescapular')?.value||0),
      parseFloat(document.getElementById('d-abdominal')?.value||0),
      parseFloat(document.getElementById('d-suprailíaca')?.value||0),
      parseFloat(document.getElementById('d-coxa')?.value||0),
    ];
    const soma = dobras.reduce((a,b)=>a+b,0);
    if(soma <= 0){ fqToast('Preencha as dobras cutâneas!','warn'); return; }
    const r = calcPollock7(dobras, idade, sexo, peso);
    if(!r){ fqToast('Verifique os dados inseridos!','warn'); return; }
    evalData = {...evalData, dobras, soma:r.soma, dc:r.dc, fatPct:parseFloat(r.fatPct), fatKg:parseFloat(r.fatKg), leanKg:parseFloat(r.leanKg)};
  } else {
    const fatPct = parseFloat(document.getElementById('bio-fat')?.value||0);
    const leanKg = parseFloat(document.getElementById('bio-lean')?.value||0);
    if(!fatPct){ fqToast('Preencha o % de gordura!','warn'); return; }
    const fatKg = (fatPct/100)*peso;
    evalData = {
      ...evalData,
      fatPct, leanKg: leanKg||(peso-fatKg), fatKg,
      water: parseFloat(document.getElementById('bio-water')?.value||0),
      bone:  parseFloat(document.getElementById('bio-bone')?.value||0),
      tmb:   parseFloat(document.getElementById('bio-tmb')?.value||0),
      idademet: parseFloat(document.getElementById('bio-idademet')?.value||0),
    };
  }

  if(!u.avaliacoes) u.avaliacoes = [];
  u.avaliacoes.push(evalData);
  u.avaliacoes.sort((a,b)=>new Date(a.date)-new Date(b.date));
  DB.set('fq_users', users);
  syncU(u);
  closeModal('modal-eval');
  renderEvo(u);
  setTimeout(()=>renderPizzaCharts(u), 100);
  fqToast('✅ Avaliação salva com sucesso!','ok');
}

async function deleteEval(id){
  if(!await fqConfirm('Excluir avaliação','Remover esta avaliação corporal?','Excluir','🗑️')) return;
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  const u = users[email];
  if(!u?.avaliacoes) return;
  u.avaliacoes = u.avaliacoes.filter(e=>e.id!==id);
  DB.set('fq_users', users);
  syncU(u);
  renderEvo(u);
}

// ── RENDER GRÁFICOS SVG ──
function renderChart(svgId, data, color, unit, height, label){
  const svg = document.getElementById(svgId);
  if(!svg) return;
  if(!data || data.length < 1){
    svg.innerHTML=`<text x="150" y="${height/2+5}" text-anchor="middle" fill="rgba(255,255,255,.15)" font-size="12" font-family="Inter">Adicione avaliações para ver o gráfico</text>`;
    return;
  }
  const W = 300, H = height, pad = {t:10,r:10,b:24,l:36};
  const cW = W-pad.l-pad.r, cH = H-pad.t-pad.b;
  const vals = data.map(d=>d.val);
  const minV = Math.min(...vals)*0.97;
  const maxV = Math.max(...vals)*1.03;
  const range = maxV-minV || 1;

  const toX = i => pad.l + (i/(data.length-1||1))*cW;
  const toY = v => pad.t + cH - ((v-minV)/range)*cH;

  let html = '';

  // Grid lines
  [0,.25,.5,.75,1].forEach(t=>{
    const y = pad.t + cH*(1-t);
    const v = minV + range*t;
    html += `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" class="chart-grid"/>`;
    html += `<text x="${pad.l-4}" y="${y+4}" text-anchor="end" fill="rgba(255,255,255,.3)" font-size="9" font-family="Inter">${v.toFixed(1)}</text>`;
  });

  // Area
  if(data.length > 1){
    let aPath = `M${toX(0)},${H-pad.b}`;
    data.forEach((d,i) => aPath += ` L${toX(i)},${toY(d.val)}`);
    aPath += ` L${toX(data.length-1)},${H-pad.b} Z`;
    html += `<path d="${aPath}" fill="${color}" class="chart-area"/>`;
    // Line
    let lPath = `M${toX(0)},${toY(data[0].val)}`;
    data.forEach((d,i) => { if(i>0) lPath += ` L${toX(i)},${toY(d.val)}`; });
    html += `<path d="${lPath}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // Dots + labels
  data.forEach((d,i)=>{
    const x=toX(i), y=toY(d.val);
    html += `<circle cx="${x}" cy="${y}" r="4" fill="${color}" stroke="#0a0a0a" stroke-width="2"/>`;
    // Value label on dot
    const above = y > pad.t+14;
    html += `<text x="${x}" y="${above?y-8:y+16}" text-anchor="middle" fill="${color}" font-size="10" font-weight="700" font-family="Inter">${d.val.toFixed(1)}${unit}</text>`;
    // Date label
    const dateShort = d.date.split('-').slice(1).join('/');
    html += `<text x="${x}" y="${H-4}" text-anchor="middle" fill="rgba(255,255,255,.3)" font-size="8" font-family="Inter">${dateShort}</text>`;
  });

  svg.innerHTML = html;
}

// ── 3D PIZZA CHART ──
function draw3DPizza(canvasId, slices, opts={}){
  const canvas = document.getElementById(canvasId);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  const cx = W/2, cy = H*0.44;
  const rx = W*0.38, ry = rx*0.38; // ellipse radii for 3D
  const depth = H*0.18;            // 3D depth
  const total = slices.reduce((a,b)=>a+b.val, 0);
  if(total <= 0) return;

  let startAngle = -Math.PI/2;
  const angles = slices.map(s=>({ ...s, start:0, end:0 }));

  // Pre-calc angles
  slices.forEach((s,i)=>{
    const sweep = (s.val/total)*Math.PI*2;
    angles[i].start = startAngle;
    angles[i].end   = startAngle + sweep;
    startAngle += sweep;
  });

  // ── Draw 3D SIDES (bottom layer — drawn back-to-front) ──
  // Draw sides only for slices in the bottom half (angle between 0 and PI)
  [...angles].reverse().forEach(s=>{
    const midA = (s.start+s.end)/2;
    // Only draw side if slice faces "forward" (bottom half of circle)
    if(Math.sin(midA) > -0.1){
      ctx.beginPath();
      ctx.moveTo(cx + rx*Math.cos(s.start), cy + ry*Math.sin(s.start));
      ctx.lineTo(cx + rx*Math.cos(s.start), cy + ry*Math.sin(s.start)+depth);
      ctx.lineTo(cx + rx*Math.cos(s.end),   cy + ry*Math.sin(s.end)+depth);
      ctx.lineTo(cx + rx*Math.cos(s.end),   cy + ry*Math.sin(s.end));
      // Side: darker shade of slice color
      const c = hexToRgb(s.color);
      ctx.fillStyle = `rgba(${Math.round(c.r*0.55)},${Math.round(c.g*0.55)},${Math.round(c.b*0.55)},1)`;
      ctx.fill();
      ctx.strokeStyle='rgba(0,0,0,.3)';ctx.lineWidth=0.5;ctx.stroke();
    }
  });

  // ── Draw 3D TOPS (ellipse slices) ──
  angles.forEach(s=>{
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.ellipse(cx, cy, rx, ry, 0, s.start, s.end);
    ctx.closePath();

    // Gradient for each slice
    const midA = (s.start+s.end)/2;
    const gx = cx + rx*0.5*Math.cos(midA);
    const gy = cy + ry*0.5*Math.sin(midA);
    const grad = ctx.createRadialGradient(gx, gy, 0, cx, cy, rx);
    const c = hexToRgb(s.color);
    grad.addColorStop(0, `rgba(${Math.min(c.r+60,255)},${Math.min(c.g+60,255)},${Math.min(c.b+60,255)},1)`);
    grad.addColorStop(1, `rgba(${c.r},${c.g},${c.b},1)`);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle='rgba(10,10,10,.6)';ctx.lineWidth=1.5;ctx.stroke();
  });

  // ── Labels on slices ──
  angles.forEach(s=>{
    const pct = (s.val/total*100).toFixed(1);
    if(s.val/total < 0.05) return; // skip tiny slices
    const midA = (s.start+s.end)/2;
    const lx = cx + rx*0.62*Math.cos(midA);
    const ly = cy + ry*0.62*Math.sin(midA);
    ctx.font='bold 11px Inter,sans-serif';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillStyle='rgba(0,0,0,.7)';
    ctx.fillText(pct+'%', lx+0.5, ly+0.5);
    ctx.fillStyle='#fff';
    ctx.fillText(pct+'%', lx, ly);
  });
}

function hexToRgb(hex){
  const r=parseInt(hex.slice(1,3),16);
  const g=parseInt(hex.slice(3,5),16);
  const b=parseInt(hex.slice(5,7),16);
  return {r,g,b};
}

function renderPizzaCharts(u){
  const avs = u?.avaliacoes||[];
  if(!avs.length){
    // Draw empty placeholder
    drawEmptyPizza('pizza-fat');
    drawEmptyPizza('pizza-comp');
    return;
  }

  // Get latest evaluation
  const latest = avs[avs.length-1];
  const fatPct  = parseFloat(latest.fatPct||0);
  const leanPct = 100 - fatPct;
  const peso    = parseFloat(latest.peso||0);
  const leanKg  = parseFloat(latest.leanKg||0);
  const fatKg   = parseFloat(latest.fatKg||0);
  const sexo    = u?.anamnese?.sexo||'Masculino';
  const idade   = u?.anamnese?.nasc ? Math.floor((Date.now()-new Date(u.anamnese.nasc))/(365.25*24*3600*1000)) : 30;
  const {cls,color} = classifyFat(fatPct, sexo, idade);

  // Pizza 1: % Gordura vs Massa Magra
  draw3DPizza('pizza-fat', [
    {val: fatPct,  color:'#e50914', label:'Gordura'},
    {val: leanPct, color:'#2ecc71', label:'Magra'},
  ]);

  // Pizza 2: Composição em kg (gordura + magra + eventual osso/água)
  const water = latest.water ? (latest.water/100)*peso : null;
  const bone  = latest.bone  || null;
  const restKg = peso - leanKg - fatKg;

  let compSlices = [
    {val: fatKg,  color:'#e50914', label:`Gordura ${fatKg}kg`},
    {val: leanKg, color:'#2ecc71', label:`Magra ${leanKg}kg`},
  ];
  if(restKg > 0.5) compSlices.push({val:restKg, color:'#3498db', label:`Outros ${restKg.toFixed(1)}kg`});

  draw3DPizza('pizza-comp', compSlices);

  // Update labels
  const fatValEl = document.getElementById('pizza-fat-val');
  if(fatValEl) fatValEl.textContent = fatPct.toFixed(1)+'%';
  const fatClsEl = document.getElementById('pizza-fat-cls');
  if(fatClsEl){ fatClsEl.textContent=cls; fatClsEl.style.color=color; }
  const leanValEl = document.getElementById('pizza-lean-val');
  if(leanValEl) leanValEl.textContent = leanKg+'kg';

  // Legend
  const lgd = document.getElementById('pizza-legend');
  const lgdContent = document.getElementById('pizza-legend-content');
  if(lgd && lgdContent){
    lgd.style.display='block';
    const rows = [
      {color:'#e50914', label:'Gordura', val:fatKg+'kg / '+fatPct.toFixed(1)+'%'},
      {color:'#2ecc71', label:'Massa magra', val:leanKg+'kg / '+leanPct.toFixed(1)+'%'},
      {color:'#3498db', label:'Peso total', val:peso+'kg'},
    ];
    if(latest.water) rows.push({color:'#00bcd4',label:'Água corporal',val:latest.water+'%'});
    if(latest.bone)  rows.push({color:'#9c27b0',label:'Massa óssea',val:latest.bone+'kg'});
    if(latest.tmb)   rows.push({color:'#f39c12',label:'TMB',val:latest.tmb+' kcal'});
    lgdContent.innerHTML = rows.map(r=>`
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:12px;height:12px;border-radius:3px;background:${r.color};flex-shrink:0"></div>
        <div style="flex:1">
          <div style="font-size:10px;color:var(--mu)">${r.label}</div>
          <div style="font-size:12px;font-weight:800">${r.val}</div>
        </div>
      </div>`).join('');
  }
}

function drawEmptyPizza(id){
  const canvas = document.getElementById(id);
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  const W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const cx=W/2, cy=H*0.44, rx=W*0.38, ry=rx*0.38, depth=H*0.18;
  // Side
  ctx.beginPath();
  ctx.ellipse(cx,cy+depth,rx,ry,0,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,.04)';ctx.fill();
  // Top
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,.07)';ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.1)';ctx.lineWidth=1;ctx.stroke();
  // Text
  ctx.font='10px Inter,sans-serif';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillStyle='rgba(255,255,255,.2)';
  ctx.fillText('sem dados', cx, cy);
}

// ── RENDER EVOLUÇÃO TAB ──
function renderEvo(u){
  const avs = u?.avaliacoes||[];
  const sexo = u?.anamnese?.sexo||'Masculino';
  const idade = u?.anamnese?.nasc ? Math.floor((Date.now()-new Date(u.anamnese.nasc))/(365.25*24*3600*1000)) : 30;

  // 3D Pizza charts
  renderPizzaCharts(u);

  // Line Charts
  const fatData  = avs.filter(a=>a.fatPct).map(a=>({val:a.fatPct,  date:a.date}));
  const leanData = avs.filter(a=>a.leanKg).map(a=>({val:a.leanKg, date:a.date}));
  const pesoData = avs.filter(a=>a.peso).map(a=>({val:a.peso,      date:a.date}));

  renderChart('chart-fat-svg',  fatData,  '#e50914', '%', 120, '% Gordura');
  renderChart('chart-lean-svg', leanData, '#2ecc71', 'kg', 100, 'Massa Magra');

  // Latest values
  if(fatData.length){
    const last = fatData[fatData.length-1];
    const {cls,color} = classifyFat(last.val, sexo, idade);
    const el = document.getElementById('chart-fat-latest');
    if(el){ el.textContent=`${last.val}% — ${cls}`; el.style.color=color; }
  }
  if(leanData.length){
    const last = leanData[leanData.length-1];
    const el = document.getElementById('chart-lean-latest');
    if(el){ el.textContent=`${last.val} kg`; el.style.color='#2ecc71'; }
  }

  // History list
  const list = document.getElementById('eval-history-list');
  if(!list) return;
  if(!avs.length){
    list.innerHTML='<div style="font-size:12px;color:var(--mu);text-align:center;padding:20px 0">Nenhuma avaliação registrada ainda</div>';
    return;
  }
  list.innerHTML = [...avs].reverse().map(a=>{
    const {cls,color} = classifyFat(a.fatPct||0, sexo, idade);
    const dateF = new Date(a.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'2-digit'});
    const method = a.method==='bio'?'⚡ Bioimpedância':'🩺 Pollock 7';
    return `<div class="hist-eval-row" onclick="showEvalDetail(${a.id})">
      <div style="width:46px;height:46px;border-radius:12px;background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.2);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📊</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:800">${dateF} · ${method}</div>
        <div style="font-size:11px;color:var(--t2);margin-top:2px">${a.peso}kg · <span style="color:${color};font-weight:700">${a.fatPct}% gordura</span> · ${a.leanKg}kg magra</div>
        ${a.obs?`<div style="font-size:10px;color:var(--mu);margin-top:2px">${a.obs}</div>`:''}
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
        <span style="font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:${color}22;color:${color}">${cls}</span>
        <button onclick="event.stopPropagation();deleteEval(${a.id})" style="background:rgba(255,23,68,.08);border:1px solid rgba(255,23,68,.15);border-radius:6px;padding:3px 8px;color:#ff6b6b;font-size:10px;font-weight:700;cursor:pointer">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function showEvalDetail(id){
  const u = getU();
  const a = u?.avaliacoes?.find(e=>e.id===id);
  if(!a) return;
  const sexo = u?.anamnese?.sexo||'Masculino';
  const idade = u?.anamnese?.nasc ? Math.floor((Date.now()-new Date(u.anamnese.nasc))/(365.25*24*3600*1000)) : 30;
  const {cls,color} = classifyFat(a.fatPct||0, sexo, idade);
  const dateF = new Date(a.date+'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'});
  const method = a.method==='bio'?'⚡ Bioimpedância':'🩺 Pollock 7 Dobras';

  const dobraNames = ['Peitoral','Axilar Média','Tríceps','Subescapular','Abdominal','Supra-ilíaca','Coxa'];
  const dobrasHtml = a.dobras ? `
    <div style="font-size:10px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:1px;margin:12px 0 8px">Dobras cutâneas (mm)</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
      ${a.dobras.map((v,i)=>`<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px;display:flex;justify-content:space-between"><span style="font-size:11px;color:var(--t2)">${dobraNames[i]}</span><span style="font-size:12px;font-weight:800">${v} mm</span></div>`).join('')}
    </div>
    <div style="text-align:center;margin-top:8px;font-size:12px;color:var(--mu)">Soma total: <strong style="color:var(--t)">${a.soma} mm</strong></div>
  ` : '';

  const bioHtml = a.method==='bio' && a.water ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px">
      ${a.water?`<div style="background:rgba(52,152,219,.08);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--mu)">Água corporal</div><div style="font-size:14px;font-weight:800;color:#3498db">${a.water}%</div></div>`:''}
      ${a.bone?`<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--mu)">Massa óssea</div><div style="font-size:14px;font-weight:800">${a.bone}kg</div></div>`:''}
      ${a.tmb?`<div style="background:rgba(243,156,18,.08);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--mu)">TMB</div><div style="font-size:14px;font-weight:800;color:#f39c12">${a.tmb}kcal</div></div>`:''}
      ${a.idademet?`<div style="background:rgba(229,9,20,.06);border-radius:8px;padding:8px"><div style="font-size:9px;color:var(--mu)">Idade metabólica</div><div style="font-size:14px;font-weight:800;color:var(--r)">${a.idademet} anos</div></div>`:''}
    </div>
  ` : '';

  document.getElementById('modal-eval-title').textContent = `📊 ${dateF}`;
  abrirModal('modal-eval');
  // reuse modal body
  const body = document.querySelector('#modal-eval .modal-bx');
  body.innerHTML = `
    <div class="modal-t">
      <span>📊 Avaliação — ${dateF}</span>
      <button class="modal-cl" onclick="closeModal('modal-eval')">✕</button>
    </div>
    <div style="font-size:11px;color:var(--mu);margin-bottom:14px">${method}</div>
    <!-- Resultados principais -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.2);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:26px;font-weight:900;color:var(--r)">${a.fatPct}%</div>
        <div style="font-size:9px;color:var(--mu)">Gordura</div>
        <div style="font-size:9px;font-weight:800;margin-top:4px;padding:2px 6px;border-radius:4px;background:${color}22;color:${color}">${cls}</div>
      </div>
      <div style="background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.2);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:26px;font-weight:900;color:#2ecc71">${a.leanKg}kg</div>
        <div style="font-size:9px;color:var(--mu)">Massa Magra</div>
      </div>
      <div style="background:rgba(52,152,219,.08);border:1px solid rgba(52,152,219,.2);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:26px;font-weight:900;color:#3498db">${a.peso}kg</div>
        <div style="font-size:9px;color:var(--mu)">Peso Total</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between">
      <span style="font-size:12px;color:var(--t2)">Massa gorda</span>
      <span style="font-size:13px;font-weight:800;color:var(--r)">${a.fatKg}kg</span>
    </div>
    ${a.method!=='bio'?`<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:10px 14px;margin-bottom:12px;display:flex;justify-content:space-between"><span style="font-size:12px;color:var(--t2)">Densidade corporal</span><span style="font-size:13px;font-weight:800">${a.dc}</span></div>`:''}
    ${dobrasHtml}
    ${bioHtml}
    ${a.obs?`<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:12px;margin-top:10px;font-size:12px;color:var(--t2)"><strong>Obs:</strong> ${a.obs}</div>`:''}
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn-p" onclick="closeModal('modal-eval')" style="flex:1">Fechar</button>
      <button onclick="deleteEval(${a.id});closeModal('modal-eval')" style="flex:1;padding:14px;background:rgba(255,23,68,.08);border:1px solid rgba(255,23,68,.2);border-radius:14px;color:#ff6b6b;font-size:14px;font-weight:800;cursor:pointer">🗑️ Excluir</button>
    </div>
  `;
}

// ══ PWA ══
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));
let deferredPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredPrompt=e;setTimeout(()=>{if(!localStorage.getItem('pwa-dismissed'))document.getElementById('pwa-banner').style.display='block';},5000);});
function installPWA(){if(deferredPrompt){deferredPrompt.prompt();deferredPrompt.userChoice.then(()=>{deferredPrompt=null;dismissBanner();});}else{fqAlert('Instalar no iPhone','1. Toque em compartilhar (□↑)\n2. "Adicionar à Tela de Início"\n3. "Adicionar"','📱');dismissBanner();}}
function dismissBanner(){document.getElementById('pwa-banner').style.display='none';localStorage.setItem('pwa-dismissed','1');}

// ══ INIT ══
(async function init(){
  try{
    // Espera exercícios/treinos/ebooks carregarem dos JSONs externos antes
    // de renderizar qualquer tela — sem isso, EXERCISE_BANK/DG/DR estariam
    // vazios no primeiro render.
    await FQ_DATA_READY;
    // Session timeout: logout automático após 7 dias
    const _la=DB.get('fq_last_active');
    if(_la&&(Date.now()-_la)>7*24*60*60*1000){DB.del('fq_cur');DB.del('fq_last_active');show('sc-splash');return;}
    DB.set('fq_last_active',Date.now());
    // Voltou do Mercado Pago?
    const qs=new URLSearchParams(location.search);
    if(qs.get('pagamento')==='sucesso')setTimeout(()=>fqToast('🎉 Pagamento aprovado! Seu acesso já está liberado na Loja.','ok',7000),800);
    else if(qs.get('pagamento')==='pendente')setTimeout(()=>fqToast('⏳ Pagamento em processamento. Assim que aprovar, o acesso libera sozinho.','warn',7000),800);
    if(qs.has('pagamento'))history.replaceState(null,'',location.pathname);
    // 1) Sessão real do Supabase Auth (persistida com segurança pelo próprio Supabase)
    if(sb){
      const{data:{session}}=await sb.auth.getSession();
      if(session&&session.user){
        const fresh=await loadUDB(session.user.id);
        if(fresh){
          if(fresh.email===ADMIN_EMAIL)fresh.isAdmin=true; // admin pelo e-mail, sempre
          const users=DB.get('fq_users')||{};
          const local=users[fresh.email]||{};
          // Merge inteligente: banco NUNCA regride anamnese/plano feitos localmente
          const merged={...local,...fresh};
          if(local.anamneseDone&&!fresh.anamneseDone){merged.anamneseDone=true;merged.anamnese=local.anamnese;merged.anamneseGeral=local.anamneseGeral;}
          if(local.anamneseMuscDone&&!fresh.anamneseMuscDone){merged.anamneseMuscDone=true;merged.anamneseMusculacao=local.anamneseMusculacao;}
          if(local.anamneseCorridaDone&&!fresh.anamneseCorridaDone){merged.anamneseCorridaDone=true;merged.anamneseCorrida=local.anamneseCorrida;}
          if(local.aiPlan&&!fresh.aiPlan){merged.aiPlan=local.aiPlan;}
          else if(local.aiPlan&&fresh.aiPlan){
            // Mescla plano por tipo — nao deixa um gym/run local mais recente sumir
            merged.aiPlan={...fresh.aiPlan};
            if(local.aiPlan.gym && !fresh.aiPlan.gym) merged.aiPlan.gym=local.aiPlan.gym;
            if(local.aiPlan.run && !fresh.aiPlan.run) merged.aiPlan.run=local.aiPlan.run;
          }
          users[fresh.email]=merged;
          DB.set('fq_users',users);DB.set('fq_cur',fresh.email);
          if(merged.isAdmin){await loadAdmin();show('sc-adm');return;}
          if(!merged.anamneseDone){initAnam('geral');show('sc-anam-geral');return;}
          // NÃO gera plano automaticamente: na arquitetura atual o aluno escolhe
          // na Home se quer musculação, corrida ou os dois. Gerar aqui atropelaria
          // essa escolha e faria os cards de "criar treino" sumirem sem motivo.
          if(false){try{gerarTreinoFallback(fresh.email,merged.anamnese||{});}catch(e){}} // nunca entrar sem plano
          loadApp(fresh.email);show('sc-app');return;
        }
      }
    }
    // 2) Fallback offline: usa o cache local do último login (sem senhas armazenadas)
    const email=DB.get('fq_cur');
    if(!email){show('sc-splash');return;}
    const users=DB.get('fq_users')||{};const u=users[email];
    if(!u){DB.del('fq_cur');show('sc-splash');return;}
    if(email===ADMIN_EMAIL)u.isAdmin=true;
    if(u.isAdmin){await loadAdmin();show('sc-adm');return;}
    if(!u.anamneseDone){initAnam('geral');show('sc-anam-geral');return;}
    // NÃO gera plano automaticamente — o aluno escolhe na Home o que quer criar
    loadApp(email);show('sc-app');
  }catch(e){
    console.error('Init error:',e);
    show('sc-splash');
  }
})();

// ── CONSULTORIA ──
let consultModal = 'musculacao';
let consultPlan = 'Semestral';
function selConsultModal(m, el) {
  consultModal = m;
  document.querySelectorAll('.consult-modal').forEach(c => c.style.border = '2px solid var(--b)');
  el.style.border = '2px solid var(--r)';
}
function selConsultPlan(p, el) {
  consultPlan = p;
  document.querySelectorAll('.consult-plan').forEach(c => c.style.borderColor = 'var(--b)');
  el.style.borderColor = 'var(--r)';
}
function enviarConsultoria() {
  const nome = document.getElementById('cons-nome').value.trim();
  const fone = document.getElementById('cons-fone').value.trim();
  const obj = document.getElementById('cons-obj').value.trim();
  if (!nome) { fqToast('Por favor, preencha seu nome.','warn'); return; }
  if (!fone) { fqToast('Por favor, preencha seu WhatsApp.','warn'); return; }
  const leads = DB.get('fq_consult_leads') || [];
  leads.push({ nome, fone, obj, modalidade: consultModal, plano: consultPlan, data: new Date().toISOString(), status: 'novo' });
  DB.set('fq_consult_leads', leads);
  if (sb) { try { sb.from('consultoria_leads').insert({ nome, telefone: fone, objetivo: obj, modalidade: consultModal, plano: consultPlan, criado_em: new Date().toISOString() }).then(()=>{}).catch(()=>{}); } catch(e) {} }
  const modalLabel = consultModal === 'musculacao' ? 'Musculação' : 'Corrida';
  const PRECOS_PLANO = {Mensal:'R$197/mês', Semestral:'R$997 (6x R$166)', Anual:'R$1.697 (12x R$141)'};
  const planoComPreco = consultPlan + (PRECOS_PLANO[consultPlan] ? ' — ' + PRECOS_PLANO[consultPlan] : '');
  const msg = `Olá Rennan! Quero começar a consultoria.%0A%0A*Nome:* ${encodeURIComponent(nome)}%0A*WhatsApp:* ${encodeURIComponent(fone)}%0A*Modalidade:* ${encodeURIComponent(modalLabel)}%0A*Plano:* ${encodeURIComponent(planoComPreco)}%0A*Objetivo:* ${encodeURIComponent(obj || 'A definir')}`;
  window.open(`https://wa.me/5531995250330?text=${msg}`, '_blank');
}
// ── ADMIN: VER O APP COMO ALUNO (usa o próprio perfil autenticado do Rennan) ──
function entrarComoAluno() {
  const users = DB.get('fq_users') || {};
  const u = users[ADMIN_EMAIL];
  if(!u){fqToast('Perfil do admin ainda não carregado. Recarregue a página.','warn');return;}
  if(!u.anamneseDone){
    // Perfil de demonstração para o admin navegar no app
    u.anamneseDone=true;u.trainApproved=true;u.pacoteEbooks=true;
    u.purchases=['hypertrophy','elderly','pregnancy','disabled','fatburn','running10k','posture','stress','technique','nutrition'];
    u.anamnese=u.anamnese||{sexo:'Masculino',peso:'80',altura:'180',tempo:'Avançado (mais de 2 anos)',obj:['Hipertrofia (ganho de massa muscular)'],lesoes:['Nenhuma dor ou lesão'],temJoelho:false,temLombar:false,temOmbro:false,modal:'Ambos',dias:'4x',dur:'60'};
    users[ADMIN_EMAIL]=u;DB.set('fq_users',users);
    if(!u.aiPlan){try{gerarTreinoFallback(ADMIN_EMAIL,u.anamnese);}catch(e){}}
  }
  DB.set('fq_cur', ADMIN_EMAIL); loadApp(ADMIN_EMAIL); show('sc-app');
}
function voltarAdmin() { loadAdmin(); show('sc-adm'); }


// ══ WHATSAPP FLUTUANTE — só aparece no app ══
function updateWaFloat(){
  const btn=document.getElementById('wa-float');
  if(!btn)return;
  const appActive=document.getElementById('sc-app')?.classList.contains('active');
  btn.style.display=appActive?'flex':'none';
}
// Observar mudanças de tela
const _origShow = show;
show = function(id){
  _origShow(id);
  updateWaFloat();
};


// ══ SANITIZAÇÃO DE INPUTS ══
function sanitizeStr(str, maxLen=200){
  if(typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g,'').replace(/[<>"'`]/g,'').trim().substring(0, maxLen);
}
function sanitizeNum(val, min=0, max=300){
  const n = parseFloat(val);
  if(isNaN(n)) return min;
  return Math.min(Math.max(n, min), max);
}


// ══════════════════════════════════════════════════════
// COMUNIDADE — check-in, mapa pessoal, desafios, kudos
// Privacidade: nenhum dado de localização é público.
// O mapa é SEU. Os agregados são anônimos.
// ══════════════════════════════════════════════════════

// ─── Academias conhecidas de BH (sugestões — o aluno pode digitar qualquer uma) ───
const ACADEMIAS_SUGERIDAS=['Smart Fit','Bio Ritmo','Selfit','Academia Curves','Bodytech','Just Fit','Panobianco','Fórmula Academia','Parque das Mangabeiras','Lagoa da Pampulha','Praça do Papa','Parque Municipal','Casa','Condomínio','Ar livre'];

// ─── DESAFIOS COLETIVOS (rotativos por mês) ───
const DESAFIOS=[
  {nome:'Maratona Coletiva',desc:'Juntos vamos correr 500km este mês. Cada km seu conta!',meta:500,unidade:'km',tipo:'km'},
  {nome:'Mil Treinos',desc:'A comunidade vai completar 1.000 treinos. Bora?',meta:1000,unidade:'treinos',tipo:'treinos'},
  {nome:'Streak Coletivo',desc:'Vamos somar 300 dias de sequência entre todos!',meta:300,unidade:'dias',tipo:'streak'},
];
function desafioDoMes(){
  const m=new Date().getMonth();
  return DESAFIOS[m%DESAFIOS.length];
}

// ─── CHECK-IN ───
function fazerCheckin(){
  const nome=sanitizeStr(document.getElementById('checkin-nome').value,60);
  if(!nome){fqToast('Digite o nome do local','warn');return;}
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;
  u.checkinAtivo={local:nome,inicio:Date.now()};
  if(!u.locaisTreino)u.locaisTreino={};
  u.locaisTreino[nome]=(u.locaisTreino[nome]||0)+1;
  DB.set('fq_users',users);
  syncU(u).catch(()=>{});
  // Registra no feed anônimo local
  // Check-in é 100% privado: alimenta só a SUA lista pessoal, nunca o mural público.
  // (Postar "Fulano está na academia X agora" seria expor localização em tempo real — não fazemos isso.)
  fqToast('📍 Check-in em '+nome+'! Bom treino 💪','ok');
  renderComunidade();
}

function fazerCheckout(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u||!u.checkinAtivo)return;
  const dur=Math.round((Date.now()-u.checkinAtivo.inicio)/60000);
  const local=u.checkinAtivo.local;
  if(!u.historicoCheckins)u.historicoCheckins=[];
  u.historicoCheckins.push({local,data:new Date().toISOString(),minutos:dur});
  if(u.historicoCheckins.length>100)u.historicoCheckins=u.historicoCheckins.slice(-100);
  u.checkinAtivo=null;
  // XP por check-in (recompensa o hábito)
  u.xp=(u.xp||0)+25;
  DB.set('fq_users',users);
  syncU(u).catch(()=>{});
  fqToast(`✅ Check-out! ${dur} min em ${local} · +25 XP`,'ok');
  renderComunidade();
  loadApp(email);
}

// ─── EVENTOS DA COMUNIDADE (feed anônimo, sem dados sensíveis) ───
function registrarEventoComunidade(tipo,dados){
  const ev=DB.get('fq_com_eventos')||[];
  ev.unshift({tipo,...dados,ts:Date.now(),kudos:0});
  DB.set('fq_com_eventos',ev.slice(0,50)); // guarda os 50 mais recentes
}

const REACOES_DISPONIVEIS=['👏','🔥','💪','😮'];
function darReacao(idx,emoji){
  const ev=DB.get('fq_com_eventos')||[];
  if(!ev[idx])return;
  const meus=DB.get('fq_minhas_reacoes')||{};
  const chave=ev[idx].ts+'_'+idx;
  if(meus[chave]){fqToast('Você já reagiu a este momento','warn');return;}
  if(!ev[idx].reacoes)ev[idx].reacoes={};
  ev[idx].reacoes[emoji]=(ev[idx].reacoes[emoji]||0)+1;
  meus[chave]=emoji;
  DB.set('fq_com_eventos',ev);DB.set('fq_minhas_reacoes',meus);
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};
  if(users[email]){users[email].xp=(users[email].xp||0)+5;DB.set('fq_users',users);}
  fqToast(emoji+' Reação enviada! +5 XP','ok');
  renderMural();
}
// Compatibilidade: manter darKudos como atalho para 👏 (caso chamado de algum lugar antigo)
function darKudos(idx){darReacao(idx,'👏');}

// ─── BADGES DE EXPLORAÇÃO ───
const BADGES_LUGAR=[
  {id:'primeiro',emoji:'📍',nome:'Primeiro Check-in',cond:(u)=>Object.keys(u.locaisTreino||{}).length>=1},
  {id:'explorador',emoji:'🧭',nome:'Explorador (3 locais)',cond:(u)=>Object.keys(u.locaisTreino||{}).length>=3},
  {id:'nomade',emoji:'🌎',nome:'Nômade (5 locais)',cond:(u)=>Object.keys(u.locaisTreino||{}).length>=5},
  {id:'fiel',emoji:'❤️',nome:'Fiel (20x no mesmo lugar)',cond:(u)=>Object.values(u.locaisTreino||{}).some(v=>v>=20)},
  {id:'maratonista',emoji:'🏃',nome:'50 check-ins',cond:(u)=>(u.historicoCheckins||[]).length>=50},
];

// ─── RENDER ───
function renderComunidade(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;

  // Pulso da comunidade (agrega TODOS os usuários — sem expor nomes)
  const todos=Object.values(users);
  const agora=Date.now();const semana=7*24*60*60*1000;
  let treinosSemana=0,kmSemana=0,ativos=0;
  todos.forEach(x=>{
    const recentes=(x.workoutHistory||[]).filter(w=>agora-new Date(w.date).getTime()<semana);
    treinosSemana+=recentes.length;
    if(recentes.length)ativos++;
    kmSemana+=(x.stats?.distancia||0);
  });
  document.getElementById('com-treinos-semana').textContent=treinosSemana;
  document.getElementById('com-km-semana').textContent=Math.round(kmSemana);
  document.getElementById('com-atletas').textContent=`${ativos} atleta${ativos!==1?'s':''} ativo${ativos!==1?'s':''} · ${todos.length} na comunidade`;

  // Desafio do mês
  const d=desafioDoMes();
  let atual=0,minha=0;
  if(d.tipo==='km'){
    todos.forEach(x=>atual+=(x.stats?.distancia||0));
    minha=u.stats?.distancia||0;
  }else if(d.tipo==='treinos'){
    todos.forEach(x=>atual+=(x.stats?.treinos||0));
    minha=u.stats?.treinos||0;
  }else{
    todos.forEach(x=>atual+=(x.melhorStreak||x.streak||0));
    minha=u.melhorStreak||u.streak||0;
  }
  atual=Math.round(atual);minha=Math.round(minha);
  const pct=Math.min(100,Math.round(atual/d.meta*100));
  const hoje=new Date();
  const fimMes=new Date(hoje.getFullYear(),hoje.getMonth()+1,0);
  const diasRest=Math.ceil((fimMes-hoje)/(24*60*60*1000));
  document.getElementById('desafio-nome').textContent=d.nome;
  document.getElementById('desafio-desc').textContent=d.desc;
  document.getElementById('desafio-dias').textContent=diasRest+' dias restantes';
  document.getElementById('desafio-fill').style.width=pct+'%';
  document.getElementById('desafio-atual').textContent=`${atual} ${d.unidade} (${pct}%)`;
  document.getElementById('desafio-meta').textContent=`meta ${d.meta} ${d.unidade}`;
  document.getElementById('desafio-minha').textContent=`${minha} ${d.unidade}`;

  // Check-in ativo?
  const fAtivo=document.getElementById('checkin-atual');
  const fForm=document.getElementById('checkin-form');
  if(u.checkinAtivo){
    fAtivo.style.display='block';fForm.style.display='none';
    document.getElementById('checkin-local').textContent=u.checkinAtivo.local;
    const min=Math.round((Date.now()-u.checkinAtivo.inicio)/60000);
    document.getElementById('checkin-tempo').textContent=`Treinando há ${min} min`;
  }else{
    fAtivo.style.display='none';fForm.style.display='block';
    // Sugestões: locais que ele já usou + academias conhecidas
    const meus=Object.keys(u.locaisTreino||{});
    const sug=[...meus,...ACADEMIAS_SUGERIDAS.filter(a=>!meus.includes(a))].slice(0,6);
    document.getElementById('checkin-sugestoes').innerHTML=sug.map(s=>
      `<span class="lugar-badge${meus.includes(s)?' on':''}" onclick="document.getElementById('checkin-nome').value='${s.replace(/'/g,"")}'" style="cursor:pointer">${meus.includes(s)?'⭐ ':''}${s}</span>`
    ).join('');
  }

  renderMapaPessoal(u);
  renderBadgesLugar(u);
  renderMural();
  renderTrilha(u);
}

function renderMapaPessoal(u){
  const locais=u.locaisTreino||{};
  const nomes=Object.keys(locais).sort((a,b)=>locais[b]-locais[a]);
  document.getElementById('mapa-total').textContent=`${nomes.length} loca${nomes.length===1?'l':'is'}`;
  const grid=document.getElementById('mapa-grid');
  if(!nomes.length){
    grid.innerHTML='<div style="text-align:center;color:var(--mu);font-size:12px;padding:20px 0">Faça seu primeiro check-in<br>e seus locais aparecem aqui</div>';
    return;
  }
  // Lista simples por frequência — sem qualquer posicionamento espacial (nunca representa localização real)
  const max=Math.max(...Object.values(locais));
  grid.innerHTML=nomes.slice(0,8).map((n,i)=>{
    const pct=Math.round((locais[n]/max)*100);
    return `<div class="local-row">
      <div class="local-row-top">
        <div class="local-row-nome">${n}${i===0?'<span class="fav-tag">FAVORITO</span>':''}</div>
        <div class="local-row-count">${locais[n]}x</div>
      </div>
      <div class="local-bar-track"><div class="local-bar-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function renderBadgesLugar(u){
  document.getElementById('lugar-badges').innerHTML=BADGES_LUGAR.map(b=>{
    const ok=b.cond(u);
    return `<span class="lugar-badge${ok?' on':''}" style="${ok?'':'opacity:.4'}">${b.emoji} ${b.nome}</span>`;
  }).join('');
}

function renderMural(){
  const ev=DB.get('fq_com_eventos')||[];
  const minhas=DB.get('fq_minhas_reacoes')||{};
  const el=document.getElementById('mural-lista');
  if(!el)return;
  if(!ev.length){
    el.innerHTML='<div style="text-align:center;padding:24px;color:var(--mu);font-size:12px">Nada por aqui ainda.<br>Faça um check-in e apareça no mural! 🔥</div>';
    return;
  }
  const tempo=(ts)=>{
    const m=Math.round((Date.now()-ts)/60000);
    if(m<1)return 'agora';
    if(m<60)return m+' min atrás';
    const h=Math.round(m/60);
    if(h<24)return h+'h atrás';
    return Math.round(h/24)+'d atrás';
  };
  el.innerHTML=ev.slice(0,10).map((e,i)=>{
    const chave=e.ts+'_'+i;
    const minhaReacao=minhas[chave]||null;
    const primeiroNome=(e.nome||'Atleta').split(' ')[0];const tituloTag=e.titulo?e.titulo+' ':'';
    const ini=primeiroNome[0]?primeiroNome[0].toUpperCase():'A';
    let texto='';
    if(e.tipo==='pr')texto=`bateu um novo recorde: <strong>${e.ex}</strong> ⭐`;
    else if(e.tipo==='treino')texto=`completou o treino <strong>${e.nome_treino||'de hoje'}</strong> 💪`;
    else if(e.tipo==='streak')texto=`está com <strong>${e.dias} dias</strong> de sequência 🔥`;
    else texto='está treinando 💪';
    const reacoes=e.reacoes||{};
    const botoes=REACOES_DISPONIVEIS.map(emj=>{
      const cnt=reacoes[emj]||0;
      const ativo=minhaReacao===emj;
      if(cnt===0&&!ativo)return ''; // só mostra reação com contagem OU se foi a escolhida (evita poluir)
      return `<button class="kudos-btn${ativo?' done':''}" onclick="darReacao(${i},'${emj}')" style="margin-right:5px">${emj} ${cnt||''}</button>`;
    }).join('');
    // Se ninguém reagiu ainda, mostra os 4 botões pequenos para incentivar o primeiro toque
    const botoesFinal = botoes.trim() ? botoes : REACOES_DISPONIVEIS.map(emj=>`<button class="kudos-btn" onclick="darReacao(${i},'${emj}')" style="margin-right:5px">${emj}</button>`).join('');
    return `<div class="mural-item">
      <div class="mural-head">
        <div class="mural-av">${ini}</div>
        <div style="flex:1">
          <div style="font-size:12px">${tituloTag}<strong>${primeiroNome}</strong> ${texto}</div>
          <div style="font-size:10px;color:var(--mu)">${tempo(e.ts)}</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0">${botoesFinal}</div>
    </div>`;
  }).join('');
}


// ── Confete: micro-celebração ao completar algo (PR, desafio, nível, badge) ──
function dispararConfete(qtd=28){
  const cores=['#e50914','#ff6b35','#f39c12','#2ecc71','#3498db'];
  for(let i=0;i<qtd;i++){
    const p=document.createElement('div');
    p.className='conf-piece';
    p.style.left=Math.random()*100+'vw';
    p.style.background=cores[i%cores.length];
    p.style.animationDuration=(1.8+Math.random()*1.2)+'s';
    p.style.animationDelay=(Math.random()*0.3)+'s';
    if(Math.random()>.5)p.style.borderRadius='50%';
    document.body.appendChild(p);
    setTimeout(()=>p.remove(),3200);
  }
}


// ── Títulos desbloqueáveis (baseados em stats já sincronizados — sem infra nova) ──
const TITULOS=[
  {id:'lenda',emoji:'👑',nome:'Lenda',cond:u=>(u.melhorStreak||0)>=100},
  {id:'guerreiro',emoji:'⚔️',nome:'Guerreiro',cond:u=>(u.melhorStreak||0)>=30},
  {id:'maratonista',emoji:'🏃',nome:'Maratonista',cond:u=>(u.stats?.distancia||0)>=100},
  {id:'ferro',emoji:'🏋️',nome:'Fera do Ferro',cond:u=>(u.stats?.treinos||0)>=100},
  {id:'veterano',emoji:'🎖️',nome:'Veterano',cond:u=>(u.stats?.treinos||0)>=50},
  {id:'consistente',emoji:'📅',nome:'Consistente',cond:u=>(u.melhorStreak||0)>=7},
  {id:'novato',emoji:'🌱',nome:'Novato Dedicado',cond:u=>(u.stats?.treinos||0)>=1},
];
function tituloAtual(u){
  const t=TITULOS.find(x=>x.cond(u));
  return t||null;
}


// ── Trilha de conquistas: jornada visual baseada em XP total acumulado ──
const TRILHA_ESTACOES=[
  {xp:0,emoji:'🌱',nome:'Início'},
  {xp:500,emoji:'🐣',nome:'1os Passos'},
  {xp:1500,emoji:'💪',nome:'Pegando Ritmo'},
  {xp:3000,emoji:'🔥',nome:'Constância'},
  {xp:5000,emoji:'⚡',nome:'Em Ascensão'},
  {xp:8000,emoji:'🏋️',nome:'Forte de Vdd'},
  {xp:12000,emoji:'⚔️',nome:'Guerreiro'},
  {xp:18000,emoji:'🚀',nome:'Imparável'},
  {xp:25000,emoji:'👑',nome:'Lenda'},
];
function xpTotalAcumulado(u){
  return Math.max(0,((u.level||1)-1)*1000+(u.xp||0));
}
function renderTrilha(u){
  const el=document.getElementById('trilha-track');
  if(!el)return;
  const total=xpTotalAcumulado(u);
  let atualIdx=0;
  TRILHA_ESTACOES.forEach((e,i)=>{if(total>=e.xp)atualIdx=i;});
  document.getElementById('trilha-titulo-atual').textContent=TRILHA_ESTACOES[atualIdx].nome;
  el.innerHTML=TRILHA_ESTACOES.map((e,i)=>{
    const done=total>=e.xp;
    const atual=i===atualIdx;
    const linha=i>0?`<div class="trilha-line${TRILHA_ESTACOES[i-1].xp<=total?' done':''}"></div>`:'';
    return linha+`<div class="trilha-node">
      <div class="trilha-circ${done?' done':''}${atual?' atual':''}">${e.emoji}</div>
      <div class="trilha-lbl">${e.nome}</div>
    </div>`;
  }).join('');
  // Auto-scroll até a estação atual (se o navegador suportar)
  setTimeout(()=>{
    const nodes=el.querySelectorAll('.trilha-node');
    if(nodes[atualIdx]&&nodes[atualIdx].scrollIntoView)nodes[atualIdx].scrollIntoView({inline:'center',block:'nearest'});
  },50);
}


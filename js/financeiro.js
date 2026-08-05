// ═══════════════════════════════════════════════════════════
// FITQUEST — financeiro.js
// Checkout/pagamento, campanha de lançamento, seletor de
// plano, loja de programas, personalização com IA (program
// intake) e coleta de dados de conversão.
// ═══════════════════════════════════════════════════════════

async function checkPay(){
  const u=getU();if(!u)return;
  const fresh=await loadUDB(u.id);const users=DB.get('fq_users')||{};
  if(fresh&&fresh.trainApproved){users[u.email]={...users[u.email],...fresh};DB.set('fq_users',users);loadApp(u.email);show('sc-app');}
  else{fqToast('⏳ Pagamento ainda não confirmado. Assim que aprovar, seu acesso libera sozinho!','warn');}
}

// Cria o checkout no servidor (Edge Function) — preço vem do banco, nunca do navegador
async function fqCheckout(productId, fallbackLink){
  const u=getU();
  if(!u){show('sc-auth');switchAuth('login');return;}
  fqToast('Abrindo o pagamento seguro...','info',2500);
  try{
    if(!sb)throw new Error('offline');
    const{data:{session}}=await sb.auth.getSession();
    if(!session)throw new Error('sem-sessao');
    const res=await fetch(FN_URL+'/create-checkout',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
      body:JSON.stringify({produto:productId})
    });
    if(!res.ok)throw new Error('fn-'+res.status);
    const{init_point}=await res.json();
    if(!init_point)throw new Error('sem-link');
    window.open(init_point,'_blank');
    aguardarPagamento(productId,true);
  }catch(e){
    console.warn('Checkout automático indisponível ('+e.message+'), usando link direto.');
    if(fallbackLink){
      window.open(fallbackLink,'_blank');
      aguardarPagamento(productId,false);
    }else{
      fqAlert('Ops!','Não foi possível abrir o pagamento agora. Tente novamente em instantes.','😕');
    }
  }
}

// Modal de espera + verificação automática da compra no banco
function aguardarPagamento(productId, automatico){
  const old=document.getElementById('fq-dialog');if(old)old.remove();
  const ov=document.createElement('div');
  ov.id='fq-dialog';ov.className='fq-dlg-ov';
  ov.innerHTML=`<div class="fq-dlg"><div class="fq-paywait">
    <div class="spinner"></div>
    <div class="fq-dlg-title">Aguardando pagamento</div>
    <div class="fq-dlg-msg">${automatico
      ?'Finalize o pagamento na aba do Mercado Pago.<br>Assim que for aprovado, seu acesso libera <b>automaticamente</b> aqui — pode levar alguns segundos.'
      :'Finalize o pagamento na aba do Mercado Pago.<br>Seu acesso será liberado assim que o pagamento for confirmado.'}</div>
    <button class="fq-dlg-btn sec" style="width:100%" onclick="cancelarEsperaPagamento()">Fechar — verifico depois</button>
  </div></div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(()=>ov.classList.add('in'));
  let tentativas=0;
  clearInterval(payPollTimer);
  payPollTimer=setInterval(async()=>{
    tentativas++;
    if(tentativas>120){clearInterval(payPollTimer);return;} // ~10 min
    const ok=await verificarCompra(productId);
    if(ok){
      clearInterval(payPollTimer);
      const d=document.getElementById('fq-dialog');if(d)d.remove();
      fqToast('🎉 Pagamento aprovado! Acesso liberado!','ok',6000);
      const u=getU();if(u){renderStore(u);renderHomePrograms(u);}
    }
  },5000);
}
function cancelarEsperaPagamento(){
  clearInterval(payPollTimer);
  const d=document.getElementById('fq-dialog');if(d)d.remove();
  fqToast('Sem problema! Quando o pagamento aprovar, o acesso aparece na Loja.','info',5000);
}
// Confere no banco se a compra foi registrada pelo webhook
async function verificarCompra(productId){
  const u=getU();if(!u||!sb)return false;
  try{
    const fresh=await loadUDB(u.id);
    if(!fresh)return false;
    const tem=(fresh.purchases||[]).includes(productId)||(productId==='pacote_ebooks'&&fresh.pacoteEbooks);
    if(tem){
      const users=DB.get('fq_users')||{};
      users[u.email]={...users[u.email],purchases:fresh.purchases,pacoteEbooks:fresh.pacoteEbooks};
      DB.set('fq_users',users);
      if(productId==='pacote_ebooks'||fresh.pacoteEbooks)users[u.email].purchases=[...new Set([...(fresh.purchases||[]),'hypertrophy','elderly','pregnancy','disabled','fatburn','running10k','posture','stress','technique','nutrition'])];
      DB.set('fq_users',users);
    }
    return tem;
  }catch(e){return false;}
}

// ══ CAMPANHA DE LANÇAMENTO ══
// Os primeiros N assinantes travam o preço promocional PARA SEMPRE.
// Depois disso, os preços sobem automaticamente para quem entrar novo.
const PROMO_LIMITE = 50;
let PROMO_VAGAS_USADAS = 0;      // preenchido do banco ao abrir o app
let PROMO_CONTAGEM_OK = false;   // se falhou a leitura, honramos a promo (ver nota abaixo)

const PLANOS_PROMO = {
  mensal: {
    preco: 'R$14,90', precoDetalhe: '/mês', economia: null,
    link: 'https://mpago.la/1WnV2mh'
  },
  anual: {
    preco: 'R$9,90', precoDetalhe: '/mês', economia: 'Economize 34% · R$118,80 (em até 12x)',
    link: 'https://mpago.li/1ko8b92'
  }
};

const PLANOS_NORMAL = {
  mensal: {
    preco: 'R$19,90', precoDetalhe: '/mês', economia: null,
    link: '' // TODO: criar link de R$19,90 no Mercado Pago e colar aqui
  },
  anual: {
    preco: 'R$14,90', precoDetalhe: '/mês', economia: 'Economize 25% · R$178,80 (em até 12x)',
    link: '' // TODO: criar link de R$178,80 no Mercado Pago e colar aqui
  }
};

// A promo vale enquanto houver vaga. Se a contagem falhar (sem internet, etc.),
// mantemos a promo: é melhor honrar o preço menor do que cobrar a mais de alguém
// que viu o preço promocional na tela.
function promoAtiva(){
  if(!PROMO_CONTAGEM_OK) return true;
  return PROMO_VAGAS_USADAS < PROMO_LIMITE;
}
function promoVagasRestantes(){
  return Math.max(0, PROMO_LIMITE - PROMO_VAGAS_USADAS);
}

// PLANOS vira uma "janela" que aponta pro conjunto certo conforme a promo.
// Todo o resto do app continua usando PLANOS.mensal / PLANOS.anual normalmente.
const PLANOS = new Proxy({}, {
  get(_, prop){
    const fonte = promoAtiva() ? PLANOS_PROMO : PLANOS_NORMAL;
    return fonte[prop];
  },
  ownKeys(){ return Object.keys(PLANOS_PROMO); },
  getOwnPropertyDescriptor(){ return {enumerable:true, configurable:true}; }
});

// Busca no banco quantos alunos já assinaram (define se a promo ainda vale)
async function carregarContagemPromo(){
  try{
    if(typeof sb==='undefined' || !sb) return;
    const {count, error} = await sb.from('alunos')
      .select('id', {count:'exact', head:true})
      .eq('assinatura_status','ativa');
    if(error) return;
    PROMO_VAGAS_USADAS = count || 0;
    PROMO_CONTAGEM_OK = true;
  }catch(e){ /* mantém a promo por segurança */ }
}
const MENSALIDADE = PLANOS.mensal.preco; // mantido por compatibilidade com textos existentes

function diasRestantesTrial(u){
  if(!u||!u.trialInicio) return TRIAL_DIAS;
  const inicio = new Date(u.trialInicio);
  const agora = new Date();
  const diasPassados = Math.floor((agora - inicio)/(1000*60*60*24));
  return Math.max(0, TRIAL_DIAS - diasPassados);
}

function statusAssinatura(u){
  if(!u) return 'trial';
  if(u.isAdmin) return 'ativa';               // admin nunca é bloqueado
  if(u.assinaturaStatus === 'ativa'){
    // se tem data de validade e já passou, expirou
    if(u.assinaturaAte && new Date(u.assinaturaAte) < new Date()) return 'expirada';
    return 'ativa';
  }
  return diasRestantesTrial(u) > 0 ? 'trial' : 'expirada';
}

function temAcesso(u){ return statusAssinatura(u) !== 'expirada'; }

function renderBannerTrial(u){
  const el = document.getElementById('trial-banner');
  if(!el) return;
  const st = statusAssinatura(u);
  if(st === 'ativa'){ el.innerHTML=''; return; }

  if(st === 'trial'){
    const dias = diasRestantesTrial(u);
    const urgente = dias <= 3;
    el.innerHTML = `<div style="margin:0 20px 12px;background:${urgente?'rgba(243,156,18,.12)':'rgba(46,204,113,.1)'};border:1px solid ${urgente?'rgba(243,156,18,.35)':'rgba(46,204,113,.25)'};border-radius:10px;padding:11px 14px;display:flex;align-items:center;gap:11px">
      <div style="font-size:20px">${urgente?'⏳':'🎁'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:800;color:${urgente?'#f39c12':'#2ecc71'}">
          ${dias <= 1 ? 'Último dia grátis!' : `${dias} dias de teste grátis`}
        </div>
        <div style="font-size:10.5px;color:var(--t2)">Depois, a partir de ${PLANOS.anual.preco}/mês para continuar</div>
      </div>
      ${urgente?`<button onclick="abrirAssinatura()" style="background:#f39c12;border:none;border-radius:7px;color:#000;font-size:11px;font-weight:800;padding:7px 12px;cursor:pointer;flex-shrink:0">Assinar</button>`:''}
    </div>`;
  }
}

function abrirAssinatura(){
  abrirModal('modal-assinatura');
  renderModalAssinatura();
}

function renderModalAssinatura(){
  const el = document.getElementById('modal-assinatura-content');
  if(!el) return;
  el.innerHTML = `
    ${renderSeletorPlanos()}
    <div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:16px;text-align:left;font-size:12px;color:var(--t2);line-height:2;margin-bottom:16px">
      ✅ Musculação e corrida sob medida<br/>
      ✅ Jornada com 60 missões gamificadas<br/>
      ✅ Plano de corrida periodizado<br/>
      ✅ Comunidade e ranking<br/>
      ✅ Acompanhamento de evolução
    </div>
    <button class="btn-p" onclick="irParaPagamento(_planoSelecionado)">Assinar plano ${_planoSelecionado==='anual'?'anual':'mensal'}</button>`;
}

// ══ SELETOR DE PLANO (mensal vs anual) — compartilhado entre a tela de
// expiração e o modal de assinatura, pra manter os dois sempre consistentes. ══
let _planoSelecionado = 'anual'; // anual pré-selecionado (é o que queremos incentivar)

function renderSeletorPlanos(){
  const faixaPromo = promoAtiva() && PROMO_CONTAGEM_OK ? `
    <div style="background:linear-gradient(135deg,rgba(243,156,18,.18),rgba(243,156,18,.05));border:1px solid rgba(243,156,18,.4);border-radius:10px;padding:11px 13px;margin-bottom:12px;text-align:center">
      <div style="font-size:12px;font-weight:900;color:#f39c12">🔥 PREÇO DE FUNDADOR</div>
      <div style="font-size:11px;color:var(--t2);margin-top:3px;line-height:1.45">Restam <strong style="color:#fff">${promoVagasRestantes()} de ${PROMO_LIMITE} vagas</strong> — e você mantém esse valor pra sempre.</div>
    </div>` : '';
  return faixaPromo + `<div style="display:flex;gap:10px;margin-bottom:16px">
    ${Object.entries(PLANOS).map(([id,p])=>{
      const sel = _planoSelecionado===id;
      return `<div onclick="selecionarPlano('${id}')" style="flex:1;position:relative;cursor:pointer;
        background:${sel?'rgba(229,9,20,.1)':'var(--s)'};border:2px solid ${sel?'var(--r)':'var(--b)'};
        border-radius:12px;padding:16px 12px;text-align:center;transition:all .15s">
        ${id==='anual'?'<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:var(--r);color:#fff;font-size:9px;font-weight:800;padding:3px 10px;border-radius:5px;white-space:nowrap">MAIS ESCOLHIDO</div>':''}
        <div style="font-size:11px;color:var(--mu);font-weight:700;text-transform:uppercase;margin-top:4px">${id==='mensal'?'Mensal':'Anual'}</div>
        <div style="font-size:24px;font-weight:900;color:${sel?'var(--r)':'#fff'};margin:4px 0">${p.preco}<span style="font-size:12px;color:var(--mu);font-weight:400">${p.precoDetalhe}</span></div>
        ${p.economia?`<div style="font-size:9.5px;color:#2ecc71;font-weight:700">${p.economia}</div>`:'<div style="font-size:9.5px;color:var(--mu)">Cobrado mês a mês</div>'}
      </div>`;
    }).join('')}
  </div>`;
}

function selecionarPlano(id){
  _planoSelecionado = id;
  // re-renderiza qualquer um dos dois lugares que estiver ativo no momento
  const u = getU();
  if(document.getElementById('sc-expirado')?.classList.contains('active') && u) mostrarTelaExpirada(u);
  const modalAssin = document.getElementById('modal-assinatura');
  if(modalAssin?.classList.contains('open')) renderModalAssinatura();
}

async function irParaPagamento(planoId){
  const plano = PLANOS[planoId];
  if(!plano){ fqToast('Escolha um plano antes de continuar.','warn'); return; }
  const u = getU();
  if(!u || !u.email){ fqToast('Erro ao identificar sua conta. Faça login novamente.','warn'); return; }

  // Tenta gerar um pagamento automático (identificado com o aluno) via função no Supabase.
  // Se a função ainda não estiver configurada (ou falhar), cai pro link fixo como reserva —
  // nesse caso a liberação de acesso continua manual, pelo admin.
  try{
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/criar-pagamento`, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({email:u.email, plano:planoId})
    });
    if(resp.ok){
      const data = await resp.json();
      if(data && data.init_point){
        window.open(data.init_point, '_blank');
        fqToast('Após o pagamento, seu acesso é liberado automaticamente em instantes.','ok');
        return;
      }
    }
  }catch(e){ /* segue pro fallback abaixo */ }

  if(plano.link){
    window.open(plano.link, '_blank');
    fqToast('Após o pagamento, aguarde a liberação do seu acesso.','ok');
  }else{
    fqToast('Esse plano ainda não está disponível — em breve!','warn');
  }
}

// Bloqueia o app quando o trial expira (mostra tela de assinatura)
function verificarAcesso(){
  const u = getU();
  if(!u) return true;
  if(temAcesso(u)) return true;
  mostrarTelaExpirada(u);
  return false;
}

function mostrarTelaExpirada(u){
  const el = document.getElementById('sc-expirado');
  if(!el) return;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  el.classList.add('active');
  const nome = (u.name||'').split(' ')[0];
  const elc = document.getElementById('expirado-content');
  if(elc) elc.innerHTML = `
    <div style="text-align:center;padding:30px 24px">
      <div style="font-size:56px;margin-bottom:16px">🔓</div>
      <div style="font-size:21px;font-weight:900;margin-bottom:8px">Seus ${TRIAL_DIAS} dias acabaram, ${nome}</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:24px">
        Continue com musculação e corrida personalizadas,<br/>
        a Jornada das Missões, e-books e a comunidade completa.
      </div>
      ${renderSeletorPlanos()}
      <div style="background:var(--s);border:1px solid var(--b);border-radius:14px;padding:18px 22px;margin-bottom:18px">
        <div style="text-align:left;font-size:12px;color:var(--t2);line-height:2">
          ✅ Musculação e corrida sob medida<br/>
          ✅ Jornada com 60 missões gamificadas<br/>
          ✅ Plano de corrida periodizado<br/>
          ✅ Comunidade e ranking<br/>
          ✅ Acompanhamento de evolução
        </div>
      </div>
      <button class="btn-p" onclick="irParaPagamento(_planoSelecionado)">Assinar plano ${_planoSelecionado==='anual'?'anual':'mensal'}</button>
      <button onclick="doLogout()" style="width:100%;background:none;border:none;color:var(--mu);font-size:12px;margin-top:14px;cursor:pointer;padding:8px">Sair da conta</button>
    </div>`;
}

function loadApp(email){
  // Executa cada render isoladamente: se um falhar, os outros continuam
  // (definido no topo pra estar disponível em toda a função)
  const _safe=(fn,name)=>{try{fn();}catch(e){console.error('render '+name+':',e.message);}};
  const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;
  // Verificar se o streak quebrou (não treinou ontem nem hoje)
  if(u.ultimoTreinoStreak){
    const hoje=new Date();hoje.setHours(0,0,0,0);
    const ultimo=new Date(u.ultimoTreinoStreak);ultimo.setHours(0,0,0,0);
    const diffDias=Math.round((hoje-ultimo)/(1000*60*60*24));
    if(diffDias>1){u.streak=0;users[email]=u;} // quebrou — mostra 0 até treinar de novo
  }
  // Renovar missões semanais (toda segunda-feira)
  if(renovarMissoesSemanais(u)){users[email]=u;}
  BADGES.forEach(b=>{if(b.c(u)&&!u.badges.includes(b.id))u.badges.push(b.id);});
  DB.set('fq_users',users);
  // Nav
  document.getElementById('streak-val').textContent=(u.streak||1)+streakFlame(u.streak||1);
  // Home profile card
  const homeName=document.getElementById('home-name');if(homeName)homeName.textContent=u.name||'Atleta';
  _safe(()=>updateAvatarDisplays(u),'avatar');
  _safe(()=>renderPerfil(u),'perfil');
  _safe(()=>checkAdminBtn(),'adminBtn');
  // XP
  const xpN=(u.level||1)*1000;
  const lvEl=document.getElementById('app-lv');if(lvEl)lvEl.textContent=u.level||1;
  const lvEl2=document.getElementById('app-lv-2');if(lvEl2)lvEl2.textContent=u.level||1;
  const stEl=document.getElementById('app-st');if(stEl)stEl.textContent=(u.streak||1)+streakFlame(u.streak||1);
  const coEl=document.getElementById('app-co');if(coEl)coEl.textContent=u.coins||0;
  const coEl2=document.getElementById('app-co-2');if(coEl2)coEl2.textContent=u.coins||0;
  const xpEl=document.getElementById('app-xp');if(xpEl)xpEl.textContent=(u.xp||0).toLocaleString()+' XP';
  const xpnEl=document.getElementById('app-xpn');if(xpnEl)xpnEl.textContent=xpN.toLocaleString()+' XP';
  const xpbEl=document.getElementById('app-xpb');if(xpbEl)xpbEl.style.width=Math.min(((u.xp||0)/xpN)*100,100)+'%';
  const nmEl=document.getElementById('app-nm-small');if(nmEl)nmEl.textContent=u.name||'Atleta';
  // Stats
  document.getElementById('s-tr').textContent=u.stats?.treinos||0;
  document.getElementById('s-km').textContent=u.stats?.distancia||0;
  document.getElementById('s-pr').textContent=(u.prs||[]).length;
  document.getElementById('s-st').textContent=u.streak||1;
  // Hero
  const GP=getGP(u);const cw=`Semana ${u.gymWeek||1}`;const prog=GP[cw]||GP[Object.keys(GP)[0]];
  document.getElementById('hero-title').textContent=`${cw} · ${prog?.fase||'Treino'}`;
  document.getElementById('hero-sub').textContent='Treino montado especialmente para o seu perfil por Rennan Dias';
  // Continue cards
  const wks=Object.keys(GP);const pct=Math.round(((u.gymWeek||1)/wks.length)*100);
  const cwBarGym=document.getElementById('cw-bar-gym');if(cwBarGym)cwBarGym.style.width=pct+'%';
  const cwSubGym=document.getElementById('cw-sub-gym');if(cwSubGym)cwSubGym.textContent=`${cw} · ${prog?.fase||''}`;
  const RP=getRP(u);const rwks=Object.keys(RP);const rw=`Semana ${u.runWeek||1}`;const rprog=RP[rw]||RP[rwks[0]];
  const pctR=Math.round(((u.runWeek||1)/rwks.length)*100);
  const cwBarRun=document.getElementById('cw-bar-run');if(cwBarRun)cwBarRun.style.width=pctR+'%';
  const cwSubRun=document.getElementById('cw-sub-run');if(cwSubRun)cwSubRun.textContent=`${rw} · ${rprog?.meta||''}`;
  // Render
  _safe(()=>renderMissions(u.missions||[]),'missions');
  _safe(()=>renderRankingCarousel(u,email,users),'rankCar');
  carregarContagemPromo().then(()=>{ try{ if(typeof renderBannerTrial==='function') renderBannerTrial(u); }catch(e){} });
  carregarRanking().then(()=>{try{renderRankingCarousel(u,email,users);renderRankingFull(u,email,users);}catch(e){}});
  _safe(()=>renderHistory(u),'history');
  _safe(()=>renderGym(u),'gym');
  _safe(()=>renderRun(u),'run');
  _safe(()=>renderRankingFull(u,email,users),'rankFull');
  _safe(()=>renderPRs(u.prs||[]),'prs');
  _safe(()=>renderComunidade(),'comunidade');
  _safe(()=>renderBannerTrial(u),'trialBanner');
  _safe(()=>renderHomePlanoCards(),'planoCards');
  _safe(()=>renderHomeMissoesCard(),'missoesCard');
  _safe(()=>renderMissoes(),'missoes');
  _safe(()=>renderBadges(u.badges||[]),'badges');
  _safe(()=>renderEvo(u),'evo');
  renderStore(u);
  _safe(()=>renderHomePrograms(u),'programas');
}

// ══ COLETA DE DADOS — em que dia do teste os alunos decidem assinar ══
// Serve pra decidir com dado real (e não com opinião) se o período de
// teste atual está no tamanho certo.
function renderConversao(lista){
  const el = document.getElementById('adm-conversao');
  if(!el) return;

  const alunos = (lista||[]).filter(u=>!u.isAdmin);
  const convertidos = alunos.filter(u=>u.diaConversao!==undefined && u.diaConversao!==null);
  const total = alunos.length;

  if(!total){
    el.innerHTML = '<div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:18px;text-align:center;font-size:12px;color:var(--mu)">Nenhum aluno cadastrado ainda</div>';
    return;
  }

  const taxa = total ? Math.round(convertidos.length/total*100) : 0;

  // Distribuição por faixa de dia — mostra QUANDO a decisão acontece
  const faixas = [
    {rot:'Dia 0-1',  min:0,  max:1},
    {rot:'Dia 2-4',  min:2,  max:4},
    {rot:'Dia 5-7',  min:5,  max:7},
    {rot:'Dia 8-10', min:8,  max:10},
    {rot:'Dia 11-14',min:11, max:99},
  ];
  const cont = faixas.map(f=>({
    ...f, n: convertidos.filter(u=>u.diaConversao>=f.min && u.diaConversao<=f.max).length
  }));
  const maxN = Math.max(1, ...cont.map(f=>f.n));

  const media = convertidos.length
    ? (convertidos.reduce((a,u)=>a+(u.diaConversao||0),0)/convertidos.length).toFixed(1)
    : null;

  // Quantos assinaram até o dia 7 (se a maioria decide cedo, o teste longo não ajuda)
  const ate7 = convertidos.filter(u=>u.diaConversao<=7).length;
  const pctAte7 = convertidos.length ? Math.round(ate7/convertidos.length*100) : 0;

  el.innerHTML = `
    <div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:16px;margin-bottom:10px">
      <div style="display:flex;gap:10px;margin-bottom:14px">
        <div style="flex:1;text-align:center">
          <div style="font-size:22px;font-weight:900;color:var(--r)">${convertidos.length}/${total}</div>
          <div style="font-size:9.5px;color:var(--mu);font-weight:700;text-transform:uppercase;margin-top:2px">Assinaram</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="font-size:22px;font-weight:900;color:#2ecc71">${taxa}%</div>
          <div style="font-size:9.5px;color:var(--mu);font-weight:700;text-transform:uppercase;margin-top:2px">Conversão</div>
        </div>
        <div style="flex:1;text-align:center">
          <div style="font-size:22px;font-weight:900;color:#f39c12">${media!==null?media:'—'}</div>
          <div style="font-size:9.5px;color:var(--mu);font-weight:700;text-transform:uppercase;margin-top:2px">Dia médio</div>
        </div>
      </div>

      ${convertidos.length ? `
        <div style="font-size:10.5px;color:var(--mu);font-weight:700;margin-bottom:8px">QUANDO DECIDIRAM ASSINAR</div>
        ${cont.map(f=>`
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="font-size:10px;color:var(--t2);min-width:58px">${f.rot}</div>
            <div style="flex:1;height:16px;background:var(--s2);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${Math.round(f.n/maxN*100)}%;background:${f.n?'var(--r)':'transparent'};border-radius:4px;transition:width .3s"></div>
            </div>
            <div style="font-size:11px;font-weight:800;color:${f.n?'#fff':'var(--mu)'};min-width:18px;text-align:right">${f.n}</div>
          </div>`).join('')}

        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--b);font-size:11px;color:var(--t2);line-height:1.6">
          <strong style="color:#fff">${pctAte7}%</strong> decidiram até o dia 7.
          ${convertidos.length < 10
            ? '<span style="color:var(--mu)"><br>Amostra ainda pequena — junte ~30 assinantes antes de mudar o prazo.</span>'
            : (pctAte7 >= 80
                ? '<span style="color:#f39c12"><br>A maioria decide cedo — encurtar o teste provavelmente não perderia assinantes.</span>'
                : '<span style="color:#2ecc71"><br>Boa parte decide depois do dia 7 — o teste de 14 dias está sendo usado.</span>')}
        </div>
      ` : `
        <div style="font-size:11.5px;color:var(--mu);text-align:center;padding:10px 0;line-height:1.6">
          Nenhuma assinatura ainda.<br>Os dados aparecem aqui conforme os alunos assinarem.
        </div>`}
    </div>`;
}

function admStudentCard(u, compact=false){
  const purchases=u.purchases||[];
  const ebookCount=u.pacoteEbooks?10:purchases.length;
  const xpPct=Math.min(100,((u.xp||0)%1000)/10);
  const lastSeen=u.lastLogin?new Date(u.lastLogin).toLocaleDateString('pt-BR'):'N/A';
  const streakColor=u.streak>=7?'#f39c12':u.streak>=3?'#2ecc71':'#737373';

  return `<div class="st-card ${u.trainApproved?'ok':'pend'}">
    <!-- Header -->
    <div class="st-card-header">
      <div class="st-av" style="background:linear-gradient(135deg,${u.avatar?.color||'#e50914'},#600)">${u.name?u.name[0].toUpperCase():'?'}</div>
      <div class="st-inf">
        <div class="st-nm">${u.name||'Sem nome'}</div>
        <div class="st-em">${u.email}</div>
        <div style="font-size:9px;color:var(--mu);margin-top:2px">Cadastro: ${u.createdAt?new Date(u.createdAt).toLocaleDateString('pt-BR'):'N/A'}</div>
      </div>
      <div class="st-st ${u.trainApproved?'ok':'pend'}">${u.trainApproved?'✅ ATIVO':'⏳ PENDENTE'}</div>
    </div>
    <!-- XP progress bar -->
    <div class="st-prog-bar"><div class="st-prog-fill" style="width:${xpPct}%"></div></div>
    <!-- Metrics -->
    <div class="st-metrics">
      <div class="st-metric"><div class="st-mv" style="color:var(--r)">${u.stats?.treinos||0}</div><div class="st-ml">Treinos</div></div>
      <div class="st-metric"><div class="st-mv" style="color:#3498db">${u.stats?.distancia||0}</div><div class="st-ml">km</div></div>
      <div class="st-metric"><div class="st-mv" style="color:#f39c12">${u.level||1}</div><div class="st-ml">Nível</div></div>
      <div class="st-metric"><div class="st-mv" style="color:${streakColor}">${u.streak||0}🔥</div><div class="st-ml">Streak</div></div>
      <div class="st-metric"><div class="st-mv" style="color:#9b59b6">${ebookCount}</div><div class="st-ml">E-Books</div></div>
    </div>
    <!-- Anamnese quick info -->
    ${u.anamnese?`<div style="padding:8px 14px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:8px;flex-wrap:wrap">
      <div style="font-size:9px;color:var(--mu)">⚧ ${u.anamnese.sexo||'—'}</div>
      <div style="font-size:9px;color:var(--mu)">⚖️ ${u.anamnese.peso||'—'}kg</div>
      <div style="font-size:9px;color:var(--mu)">📏 ${u.anamnese.altura||'—'}cm</div>
      <div style="font-size:9px;color:var(--mu)">🎯 Semana ${u.gymWeek||1}</div>
      <div style="font-size:9px;color:var(--mu)">📅 ${lastSeen}</div>
    </div>`:''}
    <!-- Alerta de saúde — condições, medicamentos e cirurgias (antes invisível para o admin) -->
    ${admAlertaSaude(u.anamnese)}
    <!-- Actions -->
    <div class="st-actions">
      ${!u.trainApproved?`<button class="st-btn approve" onclick="admApprove('${u.email}')">✅ Liberar</button>`:''}
      ${u.trainApproved?`<button class="st-btn revoke" onclick="admRevoke('${u.email}')">🚫 Revogar</button>`:''}
      <button class="st-btn edit" onclick="openEditSt('${u.email}')">✏️ Editar</button>
      <button class="st-btn" onclick="admResetSenha('${u.email}')" style="background:rgba(52,152,219,.12);color:#3498db;border:1px solid rgba(52,152,219,.3)">🔑 Redefinir senha</button>
      <button class="st-btn anam" onclick="openAnam('${u.email}')">📋 Anamnese</button>
      <button class="st-btn ebook" onclick="openEbooksAdmin('${u.email}')">📚 E-Books</button>
      <button class="st-btn" onclick="abrirMarcarPago('${u.email}')" style="background:rgba(46,204,113,.12);color:#2ecc71;border:1px solid rgba(46,204,113,.3)">💳 Marcar como pago</button>
      <button class="st-btn del" onclick="admDel('${u.email}')">🗑️</button>
    </div>
    <div style="padding:8px 14px 0;font-size:10px;color:var(--mu)">${admStatusAssinaturaTxt(u)}</div>
  </div>`;
}

// Texto curto do status de assinatura pra aparecer no card do admin
function admStatusAssinaturaTxt(u){
  const st = typeof statusAssinatura==='function' ? statusAssinatura(u) : 'trial';
  if(st==='ativa'){
    const ate = u.assinaturaAte ? new Date(u.assinaturaAte).toLocaleDateString('pt-BR') : '—';
    return `💳 Assinatura ativa · válida até ${ate}`;
  }
  if(st==='expirada') return `⛔ Assinatura expirada`;
  const dias = typeof diasRestantesTrial==='function' ? diasRestantesTrial(u) : '?';
  return `🎁 Em trial · ${dias} dias restantes`;
}

function admRenderStudents(list, filter){
  const el=document.getElementById('students-list');
  if(!el) return;
  if(!list.length){
    el.innerHTML='<div class="adm-empty"><div class="adm-empty-icon">👥</div><div>Nenhum aluno neste filtro</div></div>';
    return;
  }
  el.innerHTML=[...list].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).map(u=>admStudentCard(u)).join('');
}

function admFilter(f,btn){
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  let all=[...(window.ADM_CACHE||[])];
  if(f==='active') all=all.filter(u=>u.trainApproved);
  else if(f==='pending') all=all.filter(u=>!u.trainApproved);
  else if(f==='ebooks') all=all.filter(u=>(u.purchases||[]).length>0||u.pacoteEbooks);
  else if(f==='inactive') all=all.filter(u=>!u.gymDone||Object.keys(u.gymDone||{}).length===0);
  admRenderStudents(all,f);
}

function admSearch(q){
  const all=window.ADM_CACHE||[];
  const filtered=q?all.filter(u=>(u.name||'').toLowerCase().includes(q.toLowerCase())||(u.email||'').toLowerCase().includes(q.toLowerCase())):all;
  admRenderStudents(filtered,'search');
}

async function admGiveAllEbooks(email){
  if(!await fqConfirm('Liberar e-books',`Liberar todos os 10 e-books para ${email}?`,'Liberar','📚')) return;
  const all=['hypertrophy','elderly','pregnancy','disabled','fatburn','running10k','posture','stress','technique','nutrition'];
  if(sb){try{await sb.from('alunos').update({purchases:all,pacote_ebooks:true}).eq('email',email);}catch(e){}}
  const users=DB.get('fq_users')||{};
  if(users[email]){users[email].purchases=all;users[email].pacoteEbooks=true;DB.set('fq_users',users);}
  await loadAdmin();
  fqToast('✅ E-books liberados para '+email,'ok');
}

function admExportCSV(){
  const all=window.ADM_CACHE||[];
  const rows=[['Nome','Email','Status','Nivel','XP','Streak','Treinos','km','Semana','E-Books','Cadastro']];
  all.forEach(u=>{
    rows.push([u.name||'',u.email,u.trainApproved?'Ativo':'Pendente',u.level||1,u.xp||0,u.streak||0,u.stats?.treinos||0,u.stats?.distancia||0,u.gymWeek||1,(u.purchases||[]).length+(u.pacoteEbooks?10:0),u.createdAt?new Date(u.createdAt).toLocaleDateString('pt-BR'):'']);
  });
  const csv=rows.map(r=>r.join(',')).join('\n');
  const a=document.createElement('a');
  a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);
  a.download='fitquest-alunos.csv';
  a.click();
}

async function admSendAll(){
  if(!await fqConfirm('Liberar todos','Liberar treino para TODOS os alunos pendentes?','Liberar todos','🚀')) return;
  if(sb){try{await sb.from('alunos').update({treino_liberado:true}).eq('treino_liberado',false);}catch(e){}}
  const users=DB.get('fq_users')||{};
  Object.keys(users).forEach(e=>{if(users[e].email!==ADMIN_EMAIL) users[e].trainApproved=true;});
  DB.set('fq_users',users);
  await loadAdmin();
  fqToast('✅ Todos os alunos foram liberados!','ok');
}

async function admApprove(e){if(sb)await sb.from('alunos').update({treino_liberado:true}).eq('email',e);const users=DB.get('fq_users')||{};if(users[e]){users[e].trainApproved=true;DB.set('fq_users',users);}await loadAdmin();fqToast('✅ Aluno liberado!','ok');}
async function admRevoke(e){if(!await fqConfirm('Revogar acesso',`Revogar o acesso de ${e}?`,'Revogar','🚫'))return;if(sb)await sb.from('alunos').update({treino_liberado:false}).eq('email',e);const users=DB.get('fq_users')||{};if(users[e]){users[e].trainApproved=false;DB.set('fq_users',users);}await loadAdmin();}
async function admDel(e){if(!await fqConfirm('Excluir aluno',`Excluir ${e} definitivamente? Os dados de treino serão perdidos.`,'Excluir','🗑️'))return;if(sb){try{await sb.from('alunos').delete().eq('email',e);}catch(err){}}const users=DB.get('fq_users')||{};delete users[e];DB.set('fq_users',users);await loadAdmin();}

// BANK
let bankF='';let muscF='';
function renderBank(){
  const muscles=[...new Set(EXERCISE_BANK.map(e=>e.muscle))].sort();
  document.getElementById('muscle-filters').innerHTML=`<button onclick="muscF='';renderBank()" style="padding:5px 10px;border-radius:4px;border:none;background:${!muscF?'var(--r)':'rgba(255,255,255,.05)'};color:${!muscF?'#fff':'var(--mu)'};font-size:10px;font-weight:700;cursor:pointer">Todos</button>`+muscles.map(m=>`<button onclick="muscF='${m}';renderBank()" style="padding:5px 10px;border-radius:4px;border:none;background:${muscF===m?'var(--r)':'rgba(255,255,255,.05)'};color:${muscF===m?'#fff':'var(--mu)'};font-size:10px;font-weight:700;cursor:pointer">${m}</button>`).join('');
  const filt=EXERCISE_BANK.filter(e=>(!bankF||e.name.toLowerCase().includes(bankF.toLowerCase()))&&(!muscF||e.muscle===muscF));
  document.getElementById('exercise-bank-list').innerHTML=filt.map(e=>`<div style="background:var(--s);border:1px solid var(--b);border-radius:8px;padding:12px;margin-bottom:8px"><div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><div style="width:36px;height:36px;border-radius:6px;background:rgba(229,9,20,.1);display:flex;align-items:center;justify-content:center;font-size:18px">${e.emoji||'🏋️'}</div><div style="flex:1"><div style="font-size:13px;font-weight:800">${exNome(e)}</div><div style="font-size:10px;color:var(--mu)">${e.muscle} · ${e.equipment}</div></div><div style="display:flex;gap:5px"><button class="btn-sm btn-ed" onclick="openAddEx('${e.id}')">✏️</button><button class="btn-sm btn-dl" onclick="delEx('${e.id}')">🗑️</button></div></div><div style="font-size:10px;color:var(--t2);background:rgba(255,255,255,.03);border-radius:6px;padding:6px 8px">💡 ${e.obs}</div></div>`).join('');
}
function filterBank(){bankF=document.getElementById('bank-search').value;renderBank();}
function openAddEx(id=null){
  const ex=id?EXERCISE_BANK.find(e=>e.id===id):{id:'e'+String(EXERCISE_BANK.length+1).padStart(3,'0'),name:'',muscle:'',equipment:'',emoji:'🏋️',obs:''};
  document.getElementById('modal-ex-title').textContent=id?'✏️ Editar':'➕ Novo Exercício';
  document.getElementById('modal-ex-content').innerHTML=`<div class="fg"><label class="fl">Nome</label><input class="fi" id="ex-name" value="${ex.name}" placeholder="Ex: Supino Plano"/></div><div class="fr"><div class="fg"><label class="fl">Músculo</label><input class="fi" id="ex-muscle" value="${ex.muscle}" placeholder="Peito"/></div><div class="fg"><label class="fl">Equipamento</label><input class="fi" id="ex-equip" value="${ex.equipment}" placeholder="Barra"/></div></div><div class="fr"><div class="fg"><label class="fl">Emoji</label><input class="fi" id="ex-emoji" value="${ex.emoji||'🏋️'}" placeholder="🏋️"/></div></div><div class="fg"><label class="fl">Dica de execução</label><textarea class="fi" id="ex-obs" placeholder="Descreva...">${ex.obs}</textarea></div><button class="btn-p" onclick="saveEx('${ex.id}')">💾 Salvar</button>`;
  abrirModal('modal-adm-ex');
}
function saveEx(id){
  const name=document.getElementById('ex-name').value.trim();const muscle=document.getElementById('ex-muscle').value.trim();
  if(!name||!muscle){fqToast('Nome e músculo obrigatórios.','warn');return;}
  const obj={id,name,muscle,equipment:document.getElementById('ex-equip').value.trim(),emoji:document.getElementById('ex-emoji').value.trim()||'🏋️',obs:document.getElementById('ex-obs').value.trim()};
  const idx=EXERCISE_BANK.findIndex(e=>e.id===id);if(idx>=0)EXERCISE_BANK[idx]=obj;else EXERCISE_BANK.push(obj);
  closeModal('modal-adm-ex');renderBank();fqToast('✅ Exercício salvo!','ok');
}
async function delEx(id){if(!await fqConfirm('Excluir exercício','Remover este exercício do banco?','Excluir','🗑️'))return;const i=EXERCISE_BANK.findIndex(e=>e.id===id);if(i>=0)EXERCISE_BANK.splice(i,1);renderBank();}

// EDIT STUDENT
let editEmail=null;let editGW='Semana 1';let editRW='Semana 1';
function ensureAP(u){if(!u.aiPlan)u.aiPlan={gym:JSON.parse(JSON.stringify(DG)),run:JSON.parse(JSON.stringify(DR))};if(!u.aiPlan.gym)u.aiPlan.gym=JSON.parse(JSON.stringify(DG));if(!u.aiPlan.run)u.aiPlan.run=JSON.parse(JSON.stringify(DR));}
function openEditSt(email){
  editEmail=email;editGW='Semana 1';editRW='Semana 1';
  const users=DB.get('fq_users')||{};const u=users[email];
  document.getElementById('modal-st-name').textContent='✏️ '+u.name;
  const GP=u.aiPlan?.gym||DG;const RP=u.aiPlan?.run||DR;
  document.getElementById('modal-st-content').innerHTML=`
    <div class="ed-sec"><div class="ed-stt">🏋️ Musculação</div><div class="wsel" id="egw-tabs">${Object.keys(GP).map(w=>`<div class="wsb ${w===editGW?'active':''}" onclick="selEGW('${w}',this)">${w}</div>`).join('')}</div><div id="egw-content"></div></div>
    <div class="ed-sec"><div class="ed-stt">🏃 Corrida</div><div class="wsel" id="erw-tabs">${Object.keys(RP).map(w=>`<div class="wsb ${w===editRW?'active':''}" onclick="selERW('${w}',this)">${w}</div>`).join('')}</div><div id="erw-content"></div></div>`;
  abrirModal('modal-student');
  renderEGW(editGW,u);renderERW(editRW,u);
}
function selEGW(w,el){editGW=w;document.querySelectorAll('#egw-tabs .wsb').forEach(b=>b.classList.remove('active'));el.classList.add('active');const users=DB.get('fq_users')||{};renderEGW(w,users[editEmail]);}
function selERW(w,el){editRW=w;document.querySelectorAll('#erw-tabs .wsb').forEach(b=>b.classList.remove('active'));el.classList.add('active');const users=DB.get('fq_users')||{};renderERW(w,users[editEmail]);}
function renderEGW(w,u){
  ensureAP(u);if(!u.aiPlan.gym[w])u.aiPlan.gym[w]=JSON.parse(JSON.stringify(DG[w]||{fase:'Nova fase',days:{'Treino A':[]}}));
  const prog=u.aiPlan.gym[w];
  let h=`<div class="fg"><label class="fl">Fase</label><input class="mi" style="font-size:13px;padding:8px;width:100%;margin-bottom:8px" id="ef" value="${prog.fase||''}"/></div>`;
  Object.keys(prog.days).forEach(day=>{
    h+=`<div style="font-size:11px;font-weight:800;color:var(--r);margin:8px 0 5px">${day}</div>`;
    prog.days[day].forEach((ed,ei)=>{const ex=getExById(ed.id);
      h+=`<div class="exer"><div class="exer-t"><div style="font-size:12px;font-weight:700">${ex?ex.name:ed.id}</div><button onclick="remSEx('${w}','${day}',${ei})" style="background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.15);border-radius:4px;padding:2px 7px;color:var(--r);font-size:9px;cursor:pointer;">✕</button></div>
      <div class="exer-g"><div><div class="ml2">Exercício</div><select class="mi" data-day="${day}" data-idx="${ei}" data-field="id">${EXERCISE_BANK.map(e=>`<option value="${e.id}" ${e.id===ed.id?'selected':''}>${e.name}</option>`).join('')}</select></div><div><div class="ml2">Séries</div><input class="mi" type="number" data-day="${day}" data-idx="${ei}" data-field="sets" value="${ed.sets}"/></div><div><div class="ml2">Reps</div><input class="mi" data-day="${day}" data-idx="${ei}" data-field="reps" value="${ed.reps}"/></div></div>
      <div class="exer-g"><div><div class="ml2">Carga</div><input class="mi" data-day="${day}" data-idx="${ei}" data-field="load" value="${ed.load||''}"/></div><div><div class="ml2">Descanso(s)</div><input class="mi" type="number" data-day="${day}" data-idx="${ei}" data-field="rest" value="${ed.rest||60}"/></div></div></div>`;
    });
    h+=`<button class="btn-addex" onclick="addSEx('${w}','${day}')">+ Exercício em ${day}</button>`;
  });
  h+=`<button class="btn-savewk" onclick="saveEGW('${w}')">💾 Salvar semana</button>`;
  document.getElementById('egw-content').innerHTML=h;
}
function renderERW(w,u){
  ensureAP(u);if(!u.aiPlan.run[w])u.aiPlan.run[w]=JSON.parse(JSON.stringify(DR[w]||{meta:'Nova semana',sessions:[]}));
  const prog=u.aiPlan.run[w];
  let h=`<div class="fg"><label class="fl">Meta</label><input class="mi" style="font-size:13px;padding:8px;width:100%;margin-bottom:8px" id="erf" value="${prog.meta||''}"/></div>`;
  prog.sessions.forEach((s,si)=>{
    h+=`<div class="exer"><div class="exer-t"><div style="font-size:12px;font-weight:700">${s.day} – ${s.type}</div><button onclick="remSRun('${w}',${si})" style="background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.15);border-radius:4px;padding:2px 7px;color:var(--r);font-size:9px;cursor:pointer;">✕</button></div>
    <div class="exer-g"><div><div class="ml2">Dia</div><input class="mi" data-si="${si}" data-field="day" value="${s.day}"/></div><div><div class="ml2">Tipo</div><input class="mi" data-si="${si}" data-field="type" value="${s.type}"/></div><div><div class="ml2">Distância</div><input class="mi" data-si="${si}" data-field="dist" value="${s.dist}"/></div></div>
    <div class="exer-g"><div><div class="ml2">Pace</div><input class="mi" data-si="${si}" data-field="pace" value="${s.pace||''}"/></div><div><div class="ml2">Duração</div><input class="mi" data-si="${si}" data-field="dur" value="${s.dur||''}"/></div><div><div class="ml2">Dica</div><input class="mi" data-si="${si}" data-field="tip" value="${s.tip||''}"/></div></div></div>`;
  });
  h+=`<button class="btn-addex" onclick="addSRun('${w}')" style="border-color:rgba(229,9,20,.2);color:var(--r)">+ Sessão</button><button class="btn-savewk" onclick="saveERW('${w}')" style="margin-top:8px">💾 Salvar corrida</button>`;
  document.getElementById('erw-content').innerHTML=h;
}
function saveEGW(w){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;ensureAP(u);const ef=document.getElementById('ef');if(ef)u.aiPlan.gym[w].fase=ef.value;document.querySelectorAll('#egw-content .mi[data-field],#egw-content select[data-field]').forEach(inp=>{const day=inp.dataset.day;const idx=parseInt(inp.dataset.idx);const field=inp.dataset.field;if(day&&!isNaN(idx)&&field&&u.aiPlan.gym[w].days[day]?.[idx]!==undefined)u.aiPlan.gym[w].days[day][idx][field]=['sets','rest'].includes(field)?parseInt(inp.value)||1:inp.value;});u.trainApproved=true;DB.set('fq_users',users);syncU(u).catch(()=>{});fqToast('✅ Treino salvo!','ok');}
function saveERW(w){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;ensureAP(u);const ef=document.getElementById('erf');if(ef)u.aiPlan.run[w].meta=ef.value;document.querySelectorAll('#erw-content .mi[data-field]').forEach(inp=>{const si=parseInt(inp.dataset.si);const field=inp.dataset.field;if(!isNaN(si)&&field&&u.aiPlan.run[w].sessions[si])u.aiPlan.run[w].sessions[si][field]=inp.value;});u.trainApproved=true;DB.set('fq_users',users);syncU(u).catch(()=>{});fqToast('✅ Treino salvo!','ok');}
function addSEx(w,d){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;ensureAP(u);u.aiPlan.gym[w].days[d].push({id:EXERCISE_BANK[0]?.id||'e001',sets:3,reps:'12',load:'Moderada',rest:60});DB.set('fq_users',users);renderEGW(w,u);}
function remSEx(w,d,i){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;u.aiPlan.gym[w].days[d].splice(i,1);DB.set('fq_users',users);renderEGW(w,u);}
function addSRun(w){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;ensureAP(u);u.aiPlan.run[w].sessions.push({day:'Seg',type:'Corrida Leve',dist:'5 km',pace:'7:00 min/km',dur:'~35 min',tip:'Ritmo confortável.'});DB.set('fq_users',users);renderERW(w,u);}
function remSRun(w,i){const users=DB.get('fq_users')||{};const u=users[editEmail];if(!u)return;u.aiPlan.run[w].sessions.splice(i,1);DB.set('fq_users',users);renderERW(w,u);}
function openAnam(email){
  const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;const a=u.anamnese||{};
  const row=(k,v)=>`<div class="an-row"><span class="an-k">${k}</span><span class="an-v">${v||'—'}</span></div>`;
  document.getElementById('modal-anam-content').innerHTML=`
  <div style="background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.2);border-radius:8px;padding:10px 12px;margin-bottom:10px;font-size:11px;color:#ff8888">
    <strong>⚠️ ALERTAS DE LESÃO:</strong><br>
    Joelho: ${a.temJoelho?'🔴 SIM':'✅ Não'} | Lombar: ${a.temLombar?'🔴 SIM':'✅ Não'} | Ombro: ${a.temOmbro?'🔴 SIM':'✅ Não'}<br>
    Dor: ${a.dorInt||'Sem dor'} | ${a.lesaoDet||'Sem detalhes'}
  </div>
  <div class="an-vw">${row('Nome',u.name)}${row('E-mail',u.email)}${row('Nascimento',a.nasc)}${row('Sexo',a.sexo)}${row('Peso',a.peso?a.peso+'kg':'—')}${row('Altura',a.altura?a.altura+'cm':'—')}${row('Profissão',a.prof)}${row('Ativ. Trabalho',a.atvTrab)}</div>
  <div class="an-vw">${row('Nível',a.tempo)}${row('Modalidade',a.modal)}${row('Dias/sem',a.dias)}${row('Duração',a.dur)}${row('Local',a.local)}${row('Período',a.periodo)}${row('Objetivos',(a.obj||[]).join(', '))}${row('Obj. Secundário',a.obj2)}${row('Meta corrida',(a.mc||[]).join(', '))}${row('Prazo',a.prazo)}</div>
  <div class="an-vw">${row('Lesões',(a.lesoes||[]).join(', '))}${row('Intensidade dor',a.dorInt)}${row('Tempo de dor',a.dorTempo)}${row('Fisioterapia',a.fisio)}${row('Detalhes',a.lesaoDet)}</div>
  <div class="an-vw">${row('Condições',(a.saude||[]).join(', '))}${row('Medicamentos',a.medDesc)}${row('Cirurgias',a.cir)}${row('Histórico ativo',a.ativo)}</div>
  <div class="an-vw">${row('Biótipo',a.biotipo)}${row('Gordura',a.gordura)}${row('Foco',( a.foco||[]).join(', '))}${row('Suplementação',(a.supl||[]).join(', '))}</div>
  <div class="an-vw">${row('Sono',a.sono)}${row('Qualidade sono',a.qualSono)}${row('Estresse',a.stress)}${row('Alimentação',a.alim)}${row('Hidratação',a.agua)}${row('Hábitos',(a.habitos||[]).join(', '))}${row('Obs',a.obs)}</div>
`;
  abrirModal('modal-anam');
}

// ══ STORE / LOJA DE PROGRAMAS ══

const CATALOG = [
  {
    id:'hypertrophy',
    title:'Hipertrofia Máxima',
    subtitle:'12 semanas · Nível avançado',
    category:'specialized',
    tag:'MAIS VENDIDO',tagColor:'#f39c12',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&q=85',
    emoji:'💪', color:'#c0392b',
    desc:'O programa mais completo para quem quer ganhar massa muscular de verdade. 12 semanas periodizadas com técnicas avançadas baseadas nas evidências mais recentes da ciência do exercício.',
    highlights:['12 semanas periodizadas','Divisão ABCDE','Volume 16-20 séries/músculo','Técnicas avançadas'],
    episodes:[
      {n:1,title:'Semana 1–2: Adaptação Neural',dur:'5 dias/semana'},
      {n:2,title:'Semana 3–4: Volume Base',dur:'5 dias/semana'},
      {n:3,title:'Semana 5–8: Hipertrofia',dur:'5 dias/semana'},
      {n:4,title:'Semana 9–10: Intensificação',dur:'5 dias/semana'},
      {n:5,title:'Semana 11–12: Pico + Deload',dur:'5 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'🔬',
        title:'A ciência por trás do volume ideal',
        text:'Uma meta-análise publicada no Journal of Sports Science (Schoenfeld et al., 2017) analisou 15 estudos e concluiu que existe uma clara relação dose-resposta entre volume semanal e hipertrofia. Mais séries, mais crescimento — até um limite.\n\nUma meta-regressão mais recente (PubMed, 2024), analisando 67 estudos com 2.058 participantes, quantificou esse efeito com precisão: cada série adicional por semana gera em média 0,24% a mais de hipertrofia (IC 95%: 0,15–0,33). O volume ótimo estimado ficou em torno de 12 séries por grupo muscular por semana — com retornos decrescentes acima disso.\n\nNa prática: este programa opera na faixa de 14 a 20 séries semanais por músculo nas semanas de pico, garantindo o máximo estímulo sem ultrapassar a capacidade de recuperação.'
      },
      {
        icon:'⚡',
        title:'Frequência: 2x por semana é o ponto ideal',
        text:'Uma revisão sistemática publicada no Sports Medicine (Grgic, Schoenfeld & Latella, 2018), analisando estudos que compararam diferentes frequências de treino, concluiu que treinar cada grupo muscular duas vezes por semana produz ganhos de hipertrofia superiores a treinar apenas uma vez — quando o volume semanal é controlado.\n\nO mecanismo explicativo: a síntese proteica muscular após um treino de força dura entre 24 e 48 horas. Ao treinar cada músculo 2x por semana, você mantém a síntese proteica elevada por mais tempo ao longo da semana, criando um ambiente anabólico mais consistente.\n\nPor isso a divisão deste programa é ABCDE com cada grupo muscular aparecendo duas vezes na semana, e não o tradicional "um músculo por dia".'
      },
      {
        icon:'📈',
        title:'Sobrecarga progressiva: a única lei do treino',
        text:'Uma meta-análise publicada no British Journal of Sports Medicine (Currier et al., 2023), revisando 178 estudos com mais de 5.000 participantes, identificou a sobrecarga progressiva como a variável mais consistentemente associada a ganhos de força e hipertrofia.\n\nO corpo se adapta ao estímulo em 2 a 4 semanas. Quando isso acontece, o crescimento para. A sobrecarga progressiva resolve isso: você sistematicamente aumenta carga, volume ou dificuldade para forçar novas adaptações.\n\nEste programa utiliza periodização ondulatória: a intensidade e o volume variam semana a semana de forma planejada, evitando estagnação e garantindo que o corpo nunca se adapte completamente ao estímulo.'
      },
      {
        icon:'😴',
        title:'O músculo cresce no descanso — não no treino',
        text:'O treino é apenas o estímulo. O crescimento acontece durante a recuperação, especialmente no sono profundo (fase N3), quando o GH (hormônio do crescimento) é secretado em pico.\n\nEstudos de privação de sono mostram que dormir menos de 6 horas reduz a síntese proteica muscular em até 18% e eleva o cortisol (hormônio catabólico) cronicamente — sabotando os ganhos mesmo com treino e nutrição perfeitos.\n\nÉ por isso que as semanas de deload (semanas 4 e 8) são obrigatórias neste programa. Não é fraqueza — é estratégia comprovada. A ciência chama de "supercompensação": o corpo se adapta além do nível anterior durante o descanso.'
      },
      {
        icon:'🍗',
        title:'Proteína: quanto você realmente precisa',
        text:'A International Society of Sports Nutrition (ISSN, posição oficial 2022) recomenda 1,6 a 2,2g de proteína por kg de peso corporal por dia para maximizar a hipertrofia muscular. Para um atleta de 80kg, isso significa 128 a 176g de proteína diária.\n\nUm detalhe crítico: a proteína deve ser distribuída em 4 a 6 refeições de 30 a 40g cada, pois a síntese proteica muscular tem um teto por refeição — consumir 100g de proteína de uma vez não é mais eficiente que 30g.\n\nSobre suplementos: a creatina monohidratada tem o maior corpo de evidências de qualquer suplemento — mais de 500 estudos publicados confirmam ganhos de força de 5 a 15% e hipertrofia adicional. Dose: 3 a 5g/dia, sem fase de carga necessária.'
      }
    ]
  },
  {
    id:'elderly',
    title:'Treino 60+',
    subtitle:'8 semanas · Todos os níveis',
    category:'specialized',
    tag:'EXCLUSIVO',tagColor:'#9b59b6',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1658314755561-389d5660ee54?w=400&q=85',
    emoji:'🧓', color:'#8e44ad',
    desc:'Programa baseado em evidências para pessoas acima de 60 anos. Foco em mobilidade, equilíbrio, sarcopenia e qualidade de vida — com total segurança.',
    highlights:['Baixo impacto articular','Mobilidade e equilíbrio','Fortalecimento funcional','Adaptado para cada limitação'],
    episodes:[
      {n:1,title:'Semana 1–2: Mobilidade e Ativação',dur:'3 dias/semana'},
      {n:2,title:'Semana 3–4: Força Funcional',dur:'3 dias/semana'},
      {n:3,title:'Semana 5–6: Equilíbrio e Coordenação',dur:'3 dias/semana'},
      {n:4,title:'Semana 7–8: Manutenção Ativa',dur:'3 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'⚠️',
        title:'Sarcopenia: a ameaça silenciosa da longevidade',
        text:'Uma revisão sistemática publicada no Journal of Clinical Medicine (2024), analisando 11 ensaios clínicos randomizados com 792 participantes (média de 75 anos), confirmou que intervenções de exercício físico melhoram significativamente força de preensão, velocidade de marcha, massa muscular e controle postural em idosos com e sem sarcopenia.\n\nA sarcopenia afeta entre 10% e 40% das pessoas acima de 60 anos, e sua consequência mais grave não é a fraqueza em si — é a cascata de dependência que desencadeia. Idosos sarcopênicos têm 3 vezes mais risco de quedas, internações e mortalidade precoce.\n\nA boa notícia, comprovada pela ciência: o músculo esquelético mantém plasticidade ao longo de toda a vida. Pessoas de 80, 85 e até 90 anos respondem ao treinamento resistido com ganhos mensuráveis de força e massa muscular.'
      },
      {
        icon:'🦵',
        title:'Quedas: números que chocam e o que a ciência faz',
        text:'Uma revisão abrangente publicada na NIH/PMC (2024), analisando 155 estudos publicados entre 2004 e 2024, confirmou que exercícios de equilíbrio e força melhoram controle postural, estabilidade da marcha e coordenação neuromuscular — os três fatores biomecânicos que determinam o risco de queda.\n\nOs resultados são impressionantes: programas multicomponentes (força + equilíbrio + coordenação) reduzem o risco de quedas em até 40% em idosos de alto risco. O Tai Chi, especificamente, demonstrou os melhores resultados para controle postural e resposta neuromuscular.\n\nEste programa integra exercícios de força funcional + equilíbrio estático e dinâmico + treinamento de reação, exatamente o modelo que a ciência identifica como mais eficaz para prevenção de quedas.'
      },
      {
        icon:'💊',
        title:'Proteína: a dupla força-nutrição que muda tudo',
        text:'Uma meta-análise publicada no Epidemiology & Health (2024), revisando múltiplos ensaios clínicos com idosos sarcopênicos, demonstrou que a combinação de treinamento resistido + suplementação proteica é significativamente mais eficaz do que o exercício isolado para aumentar massa e força muscular.\n\nO problema específico dos idosos: o que os cientistas chamam de "resistência anabólica" — os músculos de pessoas mais velhas respondem menos eficientemente à proteína alimentar. Para compensar, a necessidade proteica sobe para 1,2 a 1,6g/kg/dia (acima dos 0,8g/kg recomendados para adultos sedentários).\n\nFontes ideais: whey protein (rápida absorção), frango, peixe, ovos e laticínios — distribuídos em 3 a 4 refeições ao dia para maximizar a síntese proteica.'
      },
      {
        icon:'🧠',
        title:'Exercício e cognição: o cérebro também se fortalece',
        text:'Revisões sistemáticas recentes confirmam que o exercício físico regular em idosos melhora memória de trabalho, função executiva e velocidade de processamento cognitivo. O mecanismo: o exercício aumenta os níveis de BDNF (fator neurotrófico derivado do cérebro), uma proteína que estimula a criação de novos neurônios e fortalece sinapses existentes.\n\nUm estudo publicado no Frontiers in Aging (2024) avaliou diferentes modalidades de exercício e seus efeitos sobre sarcopenia e cognição simultaneamente, concluindo que programas combinados de força e aeróbico produzem benefícios cognitivos superiores a modalidades isoladas.\n\nAlém disso, revisões sobre qualidade de vida em idosos com sarcopenia (MDPI, 2025) mostraram que apenas 6 a 16 semanas de treino resistido intensivo melhoraram significativamente autonomia, bem-estar psicológico e percepção de saúde — dimensões subjetivas que nenhum medicamento consegue abordar.'
      }
    ]
  },
  {
    id:'pregnancy',
    title:'Gravidez Ativa',
    subtitle:'Por trimestre · Gestantes',
    category:'specialized',
    tag:'EXCLUSIVO',tagColor:'#e91e8c',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1616279969856-759f316a5ac1?w=400&q=85',
    emoji:'🤰', color:'#e91e8c',
    desc:'O programa mais seguro e completo para gestantes. Desenvolvido com base nas diretrizes oficiais do ACOG (American College of Obstetricians and Gynecologists). Exercícios adaptados para cada trimestre.',
    highlights:['Adaptado por trimestre','Baseado nas diretrizes ACOG','Exercícios seguros e supervisionados','Pós-parto incluído'],
    episodes:[
      {n:1,title:'1º Trimestre: Adaptação',dur:'3 dias/semana'},
      {n:2,title:'2º Trimestre: Fortalecimento',dur:'3 dias/semana'},
      {n:3,title:'3º Trimestre: Manutenção',dur:'3 dias/semana'},
      {n:4,title:'Pós-parto: Recuperação',dur:'2 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'✅',
        title:'O que o ACOG (2024) realmente recomenda',
        text:'O American College of Obstetricians and Gynecologists (ACOG), em suas diretrizes atualizadas mais recentemente em setembro de 2024, é explícito: mulheres com gravidez sem complicações devem praticar pelo menos 150 minutos de exercício aeróbico moderado por semana, distribuídos ao longo dos dias.\n\nA organização afirma categoricamente que exercícios aeróbicos e de força devem ser encorajados antes, durante e após a gravidez. Mulheres que já treinavam intensamente antes de engravidar podem continuar suas atividades — com monitoramento.\n\nA hesitação histórica de médicos sobre exercício na gravidez não tem base nas evidências atuais. Para uma gravidez saudável sem complicações, os riscos são mínimos e os benefícios são extensos e bem documentados.'
      },
      {
        icon:'📊',
        title:'Benefícios comprovados para mãe e bebê',
        text:'Uma revisão publicada no PMC/NIH (2024), analisando novos ensaios clínicos randomizados e revisões sistemáticas, confirmou que exercício durante a gravidez reduz significativamente o risco de diabetes gestacional, hipertensão e ganho de peso excessivo — as três complicações mais prevalentes.\n\nO ACOG (2020, posição ainda vigente) acrescenta: mulheres que se exercitam durante a gravidez têm taxas menores de parto cesáreo, menor tempo de recuperação pós-parto, e menor risco de transtornos depressivos no pós-parto.\n\nPara o bebê: estudos observacionais mostram que os filhos de mães ativas durante a gravidez nascem com peso mais adequado, frequência cardíaca em repouso mais baixa e melhor tolerância ao estresse do parto.'
      },
      {
        icon:'📅',
        title:'O que muda em cada trimestre',
        text:'1º Trimestre (até 13ª semana): fadiga e náusea são os principais desafios. O volume hormonal (especialmente progesterona e hCG) causa cansaço profundo. O foco é manter atividade leve a moderada — qualquer movimento é melhor que nenhum. Evitar superaquecimento é prioritário.\n\n2º Trimestre (14ª a 27ª semana): geralmente o melhor período. Os hormônios se estabilizam, a energia volta e o útero ainda não é grande o suficiente para interferir no movimento. Ideal para fortalecimento de core, glúteos e assoalho pélvico.\n\n3º Trimestre (28ª semana em diante): o centro de gravidade muda. Exercícios em posição supina devem ser evitados (podem comprimir a veia cava inferior). Foco em equilíbrio, respiração e preparação para o trabalho de parto.'
      },
      {
        icon:'💪',
        title:'O assoalho pélvico: o músculo mais negligenciado',
        text:'O assoalho pélvico é um conjunto de músculos e ligamentos que sustenta útero, bexiga e intestino. Durante a gravidez, ele suporta um peso progressivo de até 6kg de bebê + placenta + líquido amniótico — durante meses.\n\nMultiplos estudos mostram que mulheres que fortalecem o assoalho pélvico durante a gravidez têm trabalho de parto mais curto, menos risco de incontinência urinária (que afeta 50% das mulheres no pós-parto), e recuperação pós-cesárea ou pós-parto vaginal significativamente mais rápida.\n\nTodos os módulos deste programa incluem exercícios de Kegel progressivos, pontes pélvicas adaptadas e respiração diafragmática — protocolo baseado nas recomendações da Sociedade Brasileira de Fisioterapia em Saúde da Mulher.'
      }
    ]
  },
  {
    id:'disabled',
    title:'Movimento Livre',
    subtitle:'Pessoas com deficiência',
    category:'specialized',
    tag:'INCLUSIVO',tagColor:'#00acc1',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1576678927484-cc907957088c?w=400&q=85',
    emoji:'♿', color:'#00acc1',
    desc:'Programa inclusivo adaptado para pessoas com deficiência física. Cada exercício possui variações com embasamento científico e adaptações específicas por tipo de limitação.',
    highlights:['Adaptações para cada deficiência','Cadeirante, amputado e outros','Foco em autonomia e força','100% acessível'],
    episodes:[
      {n:1,title:'Semana 1–2: Avaliação e Base',dur:'3 dias/semana'},
      {n:2,title:'Semana 3–4: Fortalecimento',dur:'3 dias/semana'},
      {n:3,title:'Semana 5–6: Resistência',dur:'3 dias/semana'},
      {n:4,title:'Semana 7–8: Performance',dur:'3 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'💡',
        title:'Exercício adaptado: o que a ciência prova',
        text:'As diretrizes internacionais de atividade física para pessoas com deficiência (WHO, 2020; ACSM, 2022) são claras: pessoas com deficiência física têm as mesmas capacidades de adaptação ao exercício que pessoas sem deficiência — o que muda é a forma de aplicação.\n\nEstudos com atletas paralímpicos demonstram que o treinamento resistido adaptado produz ganhos de força, hipertrofia e composição corporal comparáveis aos de atletas olímpicos convencionais. O músculo não sabe se a pessoa é cadeirante ou não — ele responde ao estímulo mecânico da mesma forma.\n\nA barreira não é biológica — é de acesso a programas bem estruturados e profissionais capacitados. Este programa preenche exatamente essa lacuna.'
      },
      {
        icon:'🦾',
        title:'Benefícios específicos para cada tipo de deficiência',
        text:'Para cadeirantes: o treinamento de membros superiores é especialmente crítico. Usuários de cadeira de rodas realizam em média 1.000 a 3.000 propulsões por dia — sem força e resistência muscular adequadas, o resultado é síndrome do manguito rotador, tendinite e dor crônica em ombros. Este programa fortalece preventivamente toda a cintura escapular.\n\nPara amputados: a assimetria muscular causada pela ausência de um membro cria compensações que sobrecarregam articulações do lado oposto. O fortalecimento do membro residual e do contralateral corrige esse desequilíbrio, melhora o uso de próteses e reduz dores compensatórias.\n\nPara condições neuromusculares: o exercício regular melhora a eficiência neuromuscular (o cérebro aprende a recrutar melhor as fibras disponíveis), reduz espasticidade em casos de paralisia parcial e melhora qualidade de vida objetivamente mensurável.'
      },
      {
        icon:'❤️',
        title:'Saúde cardiovascular: risco aumentado, solução comprovada',
        text:'Pessoas com deficiência física têm risco cardiovascular significativamente maior que a população geral — resultado de menor mobilidade, maior tendência ao sedentarismo e, em muitos casos, medicamentos que afetam o metabolismo.\n\nA American Heart Association (AHA) inclui o exercício adaptado como intervenção de primeira linha para redução de risco cardiovascular em PcD. Revisões mostram que programas de 8 a 12 semanas de exercício aeróbico adaptado reduzem pressão arterial, melhora perfil lipídico e aumentam VO₂ máximo em populações com diversas deficiências.\n\nAlém disso, uma revisão sistemática recente confirmou que programas de exercício adaptado reduzem sintomas de depressão e ansiedade em PcD em até 40% — benefício de saúde mental que nenhuma medicação consegue reproduzir com os mesmos efeitos colaterais positivos.'
      },
      {
        icon:'🎯',
        title:'Como as adaptações são estruturadas neste programa',
        text:'Cada exercício deste programa vem com 3 variações de adaptação, baseadas no modelo de classificação funcional utilizado em esportes paralímpicos:\n\n🟢 Nível 1 — Adaptação máxima: exercícios modificados para quem tem limitação severa ou está iniciando. Foco em ativação e controle motor.\n\n🟡 Nível 2 — Adaptação moderada: progressão com resistência leve a moderada. Inclui uso de equipamentos adaptados como faixas elásticas e anilhas.\n\n🔴 Nível 3 — Alta performance: versão de máximo desafio para cada condição. Permite que você alcance resultados de performance comparáveis à população geral.\n\nA progressão é guiada pela percepção subjetiva de esforço (Escala de Borg), não por peso absoluto — tornando o programa seguro e eficaz independentemente do nível inicial.'
      }
    ]
  },
  {
    id:'fatburn',
    title:'Emagrecimento Total',
    subtitle:'12 semanas · Iniciante/Intermediário',
    category:'weight',
    tag:'TOP 1',tagColor:'#e50914',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=400&q=85',
    emoji:'🔥', color:'#e50914',
    desc:'O programa definitivo para perda de gordura. Combinação de musculação metabólica + HIIT baseada nas evidências científicas mais recentes para máximo gasto calórico e preservação da massa magra.',
    highlights:['Musculação + HIIT + Corrida','Déficit calórico otimizado','Preserva massa magra','Progressão semana a semana'],
    episodes:[
      {n:1,title:'Semana 1–3: Ativação Metabólica',dur:'4 dias/semana'},
      {n:2,title:'Semana 4–6: HIIT Progressivo',dur:'4 dias/semana'},
      {n:3,title:'Semana 7–9: Aceleração',dur:'5 dias/semana'},
      {n:4,title:'Semana 10–12: Definição Final',dur:'5 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'🔬',
        title:'HIIT vs. cardio contínuo: o veredito da ciência',
        text:'Um estudo publicado no Scientific Reports (Nature, abril de 2024) comparou diretamente HIIT e treinamento contínuo de intensidade moderada (MICT) com o mesmo gasto calórico em homens com obesidade. Resultado: o EPOC (consumo excessivo de oxigênio pós-exercício) foi significativamente maior após HIIT (66,2 kcal) versus MICT (53,9 kcal), especialmente nos primeiros 10 minutos pós-treino.\n\nMais importante: a taxa de oxidação lipídica (queima de gordura) durante o período de EPOC foi 33% maior no grupo HIIT. Isso significa que o corpo queima proporcionalmente mais gordura nas horas após um treino HIIT — não apenas mais calorias totais.\n\nOutro estudo publicado no PMC (2025), comparando HIIT, HICT e cardio moderado com o mesmo gasto calórico, confirmou: o EPOC foi quase o dobro nos protocolos de alta intensidade (319 mL vs. 168 mL no grupo moderado), com elevação de VO₂ e metabolismo sustentada por 30 a 60 minutos pós-exercício.'
      },
      {
        icon:'⚖️',
        title:'A matemática do déficit calórico inteligente',
        text:'O princípio termodinâmico é inescapável: para perder gordura, o gasto calórico precisa superar a ingestão. Mas a magnitude e a distribuição do déficit importam muito.\n\nUm déficit excessivo (acima de 1.000 kcal/dia) acelera a perda de massa magra, reduz o metabolismo basal e compromete a performance nos treinos. O déficit ideal para preservar músculo enquanto perde gordura é de 300 a 500 kcal/dia — suficiente para perder 0,3 a 0,5kg de gordura por semana.\n\nO exercício contribui diretamente para esse déficit. Um treino de musculação metabólica queima 300 a 500 kcal/hora. Um HIIT de 25 minutos, 400 a 600 kcal. Combinados, 4 treinos por semana criam um déficit semanal de 1.600 a 2.400 kcal — sem precisar passar fome.'
      },
      {
        icon:'💪',
        title:'Musculação durante o emagrecimento: por que é essencial',
        text:'A estratégia clássica de "fazer cardio para emagrecer" tem um problema fatal: ela perde músculo junto com gordura. Isso desacelera o metabolismo basal (que é determinado principalmente pela massa muscular) — criando o efeito sanfona.\n\nUm kg de músculo queima 13 a 15 kcal em repouso por dia. Um kg de gordura, apenas 4 kcal. Quanto mais músculo você mantém durante o emagrecimento, mais calorias você queima 24 horas por dia — mesmo dormindo.\n\nA musculação envia um sinal claro ao organismo: "precisamos desses músculos". Com proteína adequada (1,6g/kg/dia) e treino resistido 3 a 4 vezes por semana, é possível perder gordura sem perder músculo — ou até ganhar músculo enquanto emagrece (recomposição corporal), especialmente em iniciantes.'
      },
      {
        icon:'🍎',
        title:'Nutrição: o que realmente funciona para emagrecer',
        text:'A pesquisa atual é clara: não existe dieta "mágica". Low carb, jejum intermitente, dieta mediterrânea — todas funcionam quando criam o mesmo déficit calórico. A diferença está na aderência.\n\nO que a ciência aponta como fatores de sucesso a longo prazo: alta ingestão proteica (sacia mais e preserva músculo), alimentos com alta saciedade por caloria (vegetais, frutas, leguminosas), e flexibilidade na dieta (dietas muito restritivas têm altas taxas de abandono).\n\nUm detalhe frequentemente ignorado: a hidratação. Estudos mostram que beber 500ml de água 30 minutos antes das refeições reduz a ingestão calórica em média 13%. Desidratação leve (2% do peso corporal) reduz a performance no treino em 10 a 20% — sabotando o gasto calórico que você trabalhou para criar.'
      }
    ]
  },
  {
    id:'running10k',
    title:'Do Zero ao 10km',
    subtitle:'8 semanas · Iniciantes',
    category:'weight',
    tag:'POPULAR',tagColor:'#2ecc71',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1461897104016-0b3b00cc81ee?w=400&q=85',
    emoji:'🏃', color:'#27ae60',
    desc:'Saia do zero e complete seu primeiro 10km em 8 semanas. Programa periodizado com Fartlek, Intervalados e Long Run — baseado em princípios científicos de treinamento aeróbico.',
    highlights:['Zero a 10km em 8 semanas','Fartlek + Intervalados + Long Run','Guia de nutrição incluso','Para absolutamente iniciantes'],
    episodes:[
      {n:1,title:'Semana 1–2: Base Aeróbica',dur:'3 dias/semana'},
      {n:2,title:'Semana 3–4: Volume',dur:'3 dias/semana'},
      {n:3,title:'Semana 5–6: Velocidade',dur:'3 dias/semana'},
      {n:4,title:'Semana 7–8: Prova Simulada',dur:'3 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'❤️',
        title:'O que acontece com seu coração quando você começa a correr',
        text:'O coração é um músculo — e responde ao treinamento como qualquer outro. Com a corrida regular, o ventrículo esquerdo aumenta seu volume interno (dilatação excêntrica), permitindo bombear mais sangue a cada batida. Isso é o que os fisiologistas chamam de "coração atlético".\n\nO resultado prático é mensurável em 4 a 8 semanas: frequência cardíaca em repouso cai (corredores experientes chegam a 40-50 bpm vs. 70-80 de sedentários), VO₂ máximo — principal marcador de saúde cardiovascular — aumenta entre 15 e 25% em iniciantes após 8 semanas de treinamento progressivo.\n\nO American Heart Association aponta que 150 minutos de exercício aeróbico moderado por semana — exatamente o que este programa oferece — reduzem o risco de doença cardiovascular em 35%, acidente vascular cerebral em 25%, e mortalidade por todas as causas em 30%.'
      },
      {
        icon:'🏃',
        title:'O método Run/Walk: por que funciona para iniciantes',
        text:'O método Run/Walk, validado científicamente pelo Dr. Jeff Galloway e amplamente adotado pela medicina esportiva, é baseado em um princípio fisiológico simples: intercalar corrida com caminhada permite que o sistema cardiovascular e o sistema musculoesquelético se adaptem sem acúmulo de fadiga excessiva.\n\nEstudos com corredores iniciantes mostram que o Run/Walk reduz em até 60% o risco de lesões por sobrecarga comparado ao treino contínuo — porque dá ao tecido conjuntivo (tendões e ligamentos, que se recuperam mais lentamente que o músculo) tempo suficiente para se adaptar entre os estímulos.\n\nNas primeiras semanas deste programa, o método é aplicado progressivamente: começamos com 1 minuto correndo / 2 minutos caminhando e chegamos à corrida contínua de 10km ao final da 8ª semana.'
      },
      {
        icon:'🦵',
        title:'Prevenção de lesões: o que você precisa saber antes de começar',
        text:'Estudos epidemiológicos em corredores mostram que 65 a 80% das lesões são por overtraining — não por falta de preparo físico. O tecido conjuntivo (tendões, ligamentos, cartilagens) se adapta ao impacto da corrida muito mais lentamente que o músculo: enquanto o músculo responde em dias, o tendão leva semanas a meses.\n\nAs lesões mais comuns em iniciantes, todas preveníveis: canelite (síndrome do estresse tibial medial) — causada por aumento brusco de volume; fascite plantar — causada por calçado inadequado e fraqueza do arco plantar; joelho do corredor (síndrome patelofemoral) — causada por fraqueza do glúteo médio.\n\nEste programa inclui exercícios de fortalecimento preventivo em cada sessão: tibial anterior, glúteo médio e musculatura intrínseca do pé — exatamente as regiões identificadas pela pesquisa como protetoras contra as lesões mais comuns.'
      },
      {
        icon:'⛽',
        title:'Combustível para correr: o guia nutricional do corredor',
        text:'A corrida é um esporte altamente dependente de glicogênio muscular (carboidrato estocado no músculo). Corredores que restringem carboidratos ficam lentos, cansados e com risco aumentado de lesão — especialmente nas sessões mais longas.\n\nPré-treino (1 a 2 horas antes): 30 a 60g de carboidrato de fácil digestão. Exemplos: banana + pasta de amendoim, aveia com frutas, torrada com geleia. Evitar gordura e fibra em excesso antes de correr (digestão lenta).\n\nHidratação: perda de apenas 2% do peso corporal em água reduz a performance aeróbica em 10 a 20%. Para treinos acima de 45 minutos, repor 150 a 200ml a cada 15 a 20 minutos. Para corridas acima de 75 minutos, incluir eletrólitos (sódio, potássio) para prevenir hiponatremia.'
      }
    ]
  },
  {
    id:'posture',
    title:'Postura e Mobilidade',
    subtitle:'6 semanas · Todos os níveis',
    category:'health',
    tag:'NOVO',tagColor:'#3498db',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=400&q=85',
    emoji:'🧘', color:'#2980b9',
    desc:'Corrija sua postura, elimine dores crônicas e ganhe mobilidade com exercícios de fisioterapia preventiva baseados em evidências científicas.',
    highlights:['Correção postural','Elimina dor crônica','Mobilidade articular','Exercícios de fisioterapia'],
    episodes:[
      {n:1,title:'Semana 1–2: Diagnóstico Postural',dur:'4 dias/semana'},
      {n:2,title:'Semana 3–4: Correção Ativa',dur:'4 dias/semana'},
      {n:3,title:'Semana 5–6: Manutenção',dur:'4 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'😰',
        title:'A epidemia das dores posturais: números que impressionam',
        text:'Segundo a Organização Mundial da Saúde, a dor lombar é a principal causa de incapacidade no mundo — afetando 619 milhões de pessoas em 2020, com projeção de 843 milhões até 2050. No Brasil, é a segunda maior causa de afastamento do trabalho.\n\nMas o que causa dor nas costas em 2025? Ironicamente, não é o esforço excessivo — é a inatividade. Estudos mostram que o sedentarismo e a postura estática prolongada (8 a 10 horas sentado) enfraquecem a musculatura estabilizadora da coluna, encurtam os flexores do quadril e criam desequilíbrios musculares que sobrecarregam as articulações intervertebrais.\n\nA boa notícia: revisões sistemáticas publicadas em periódicos de reabilitação mostram que exercícios de fortalecimento e mobilidade reduzem a intensidade da dor lombar crônica em 50 a 60% após 6 a 8 semanas de prática regular.'
      },
      {
        icon:'🏗️',
        title:'Síndrome do cruzamento: o desequilíbrio do século XXI',
        text:'O fisioterapeuta Vladimir Janda descreveu a "Síndrome do Cruzamento Superior" — um padrão de desequilíbrio muscular extremamente prevalente em pessoas que trabalham sentadas: músculos do peito e pescoço anterior ficam encurtados e hiperativos, enquanto músculos das costas superiores e profundos do pescoço ficam alongados e inibidos.\n\nO resultado visual e funcional: ombros arredondados para frente, pescoço projetado para frente (postura de "tartaruga"), cifose torácica exagerada e perda de mobilidade do ombro.\n\nEste padrão não causa apenas dor — estudos mostram que reduz a capacidade pulmonar em até 30% (o diafragma trabalha comprimido), causa dores de cabeça tensionais por compressão dos nervos cervicais, e está associado a maior risco de lesão no ombro durante exercícios.'
      },
      {
        icon:'🎯',
        title:'Mobilidade funcional: o que realmente protege suas articulações',
        text:'A distinção entre mobilidade e flexibilidade é fundamental e frequentemente ignorada. Flexibilidade é amplitude passiva — você consegue ser levado até certa posição por uma força externa. Mobilidade é amplitude ativa — você consegue alcançar e controlar essa posição com seus próprios músculos.\n\nA mobilidade é o que protege articulações. Uma pessoa muito flexível mas sem mobilidade (controle ativo da amplitude) tem articulações instáveis e vulneráveis à lesão.\n\nEste programa desenvolve as 4 regiões com maior impacto na saúde articular e funcional: quadril (restrição de mobilidade do quadril é a causa número 1 de dor lombar compensatória), torácica (restrição da coluna torácica sobrecarrega cervical e lombar), ombro (mobilidade de ombro previne síndrome do impacto) e tornozelo (restrição de tornozelo compromete o agachamento e aumenta risco de joelho).'
      },
      {
        icon:'💆',
        title:'Exercícios posturais durante o trabalho: protocolo de emergência',
        text:'Pesquisas de saúde ocupacional mostram que micro-pausas de exercício durante o trabalho (2 a 5 minutos a cada hora) reduzem dor cervical e lombar em trabalhadores sedentários em até 45% após 4 semanas.\n\nTrês exercícios com mais evidência para dor postural aguda:\n\n1️⃣ Chin Tuck (retração cervical): empurre o queixo levemente para trás, como criando um duplo queixo. Ativa os flexores profundos do pescoço e descomprime as vértebras cervicais. 10 repetições, 5 segundos cada.\n\n2️⃣ Hip Hinge (dobradiça do quadril): em pé, incline o tronco para frente mantendo coluna neutra e quadril como eixo. Reativa os glúteos e isquiotibiais e ensina o padrão motor que protege a lombar.\n\n3️⃣ Rotação torácica: sentado, cruze os braços no peito e gire o tronco para cada lado. Recupera a mobilidade da coluna torácica e alivia tensão acumulada no trapézio.'
      }
    ]
  },
  {
    id:'stress',
    title:'Treino Anti-Estresse',
    subtitle:'4 semanas · Todos os níveis',
    category:'health',
    tag:'NOVO',tagColor:'#9b59b6',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1545389336-cf090694435e?w=400&q=85',
    emoji:'🌿', color:'#8e44ad',
    desc:'Combine exercício físico, respiração e mindfulness para reduzir cortisol e ansiedade. Programa baseado em meta-análises recentes sobre exercício e saúde mental.',
    highlights:['Reduz cortisol','30 minutos por dia','Respiração e mindfulness','Melhora qualidade do sono'],
    episodes:[
      {n:1,title:'Semana 1: Respiração e Movimento',dur:'5 dias/semana'},
      {n:2,title:'Semana 2: Yoga Funcional',dur:'5 dias/semana'},
      {n:3,title:'Semana 3: Cardio Leve',dur:'5 dias/semana'},
      {n:4,title:'Semana 4: Integração',dur:'5 dias/semana'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'⚗️',
        title:'O que a ciência diz sobre exercício e cortisol em 2025',
        text:'Uma meta-análise e revisão sistemática publicada no Sports (MDPI, novembro de 2025), analisando 44 ensaios clínicos randomizados sobre exercício e modulação do cortisol em pessoas com sofrimento psicológico, encontrou resultados expressivos: o exercício físico gerou reduções moderadas de cortisol (SMD geral) com efeitos mais fortes sobre estresse (SMD = 0,90), seguido de ansiedade (SMD = 0,74) e depressão (SMD = 0,54).\n\nO estudo identificou também a modalidade mais eficaz: yoga demonstrou o maior efeito sobre o cortisol (SMD = -0,59), seguido por qigong e exercícios multicomponentes. O HIIT, curiosamente, tendeu a aumentar cortisol — coerente com sua natureza de alta intensidade.\n\nA conclusão prática para este programa: a combinação de yoga funcional + cardio leve + respiração — não o exercício intenso — é o protocolo mais eficaz para redução de estresse crônico.'
      },
      {
        icon:'📉',
        title:'30-40 minutos, 3 a 5 vezes por semana: a dose exata',
        text:'Uma meta-análise publicada no PMC (2023), avaliando 12 estudos com 1.351 participantes sobre exercício e saúde mental, identificou a dose ótima com precisão: sessões de 30 a 40 minutos tiveram o efeito mais pronunciado na redução de ansiedade (SMD = -1,29) e depressão (SMD = -1,76) — superando sessões mais curtas e mais longas.\n\nA frequência ideal ficou entre 3 e 5 vezes por semana. Praticar todos os dias não mostrou benefício adicional — e pode aumentar o cortisol cronicamente.\n\nPor que isso importa: muitas pessoas acreditam que "precisam treinar muito para ter benefícios mentais". A ciência mostra que 30 minutos, 4 vezes por semana, produzem efeitos mensuráveis sobre ansiedade, humor e qualidade do sono em apenas 2 a 4 semanas.'
      },
      {
        icon:'🌬️',
        title:'A fisiologia da respiração como medicina',
        text:'O nervo vago — o "freio" do sistema nervoso simpático — pode ser ativado voluntariamente através da respiração. Especificamente, a fase expiratória longa ativa o nervo vago e induz o estado parassimpático ("rest and digest"), reduzindo frequência cardíaca e pressão arterial em segundos.\n\nA técnica 4-7-8 (inspirar em 4s, suspender em 7s, expirar em 8s) e a respiração coerente (5 segundos para inspirar, 5 para expirar, ciclo de 6 respirações por minuto) têm o maior corpo de evidências para ativação vagal e redução aguda de ansiedade.\n\nEstudos de biofeedback mostram que 5 minutos de respiração coerente reduzem a variabilidade da frequência cardíaca de forma mensurável — um marcador objetivo de ativação do sistema nervoso parassimpático. Este programa ensina e pratica essa técnica em todas as sessões.'
      },
      {
        icon:'😴',
        title:'O elo entre exercício, estresse e sono',
        text:'O estresse crônico eleva o cortisol à noite — o momento em que deveria estar no nível mais baixo. Isso atrasa o início do sono, reduz o sono profundo (fase N3, onde acontece a recuperação) e cria um ciclo vicioso: privação de sono → mais cortisol → mais estresse → menos sono.\n\nO exercício moderado é a intervenção mais eficaz para quebrar esse ciclo. Uma meta-análise do Journal of Sleep Research mostrou que exercício regular melhora eficiência do sono em 65%, reduz o tempo para adormecer em 13 minutos e aumenta o sono profundo.\n\nUm detalhe importante: o horário do treino importa. Exercícios intensos dentro de 3 horas antes de dormir aumentam temperatura corporal central e adrenalina — podendo atrasar o sono. Este programa tem versões adaptadas para quem treina à noite, com intensidade reduzida e trabalho de respiração e alongamento no final da sessão.'
      }
    ]
  },
  {
    id:'technique',
    title:'Técnica Perfeita',
    subtitle:'20 vídeo-aulas · Todos os níveis',
    category:'videos',
    tag:'VÍDEO-AULAS',tagColor:'#f39c12',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=400&q=85',
    emoji:'🎥', color:'#d35400',
    desc:'20 vídeo-aulas detalhadas cobrindo a execução perfeita dos principais exercícios, baseadas nas recomendações do NSCA e nas pesquisas mais recentes de biomecânica.',
    highlights:['20 vídeo-aulas HD','Os 20 exercícios mais importantes','Erros comuns corrigidos','Dicas de Rennan Dias'],
    episodes:[
      {n:1,title:'Módulo 1: Membros Inferiores',dur:'5 vídeos'},
      {n:2,title:'Módulo 2: Membros Superiores',dur:'8 vídeos'},
      {n:3,title:'Módulo 3: Core e Funcional',dur:'4 vídeos'},
      {n:4,title:'Módulo 4: Erros Comuns',dur:'3 vídeos'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'⚠️',
        title:'Técnica de execução: a variável mais subestimada',
        text:'Um estudo de 2024 publicado no Sports Medicine (Androulakis-Korakakis et al.) analisou as variáveis que mais impactam a hipertrofia muscular em treinos de força. Entre elas: amplitude de movimento completa produziu ganhos significativamente maiores de hipertrofia comparada à amplitude parcial — especialmente na posição de estiramento máximo do músculo.\n\nOutra descoberta importante: a fase excêntrica (descida do movimento) demonstrou ser tão ou mais importante para hipertrofia quanto a fase concêntrica (subida). Isso contradiz o hábito de "largar" o peso na descida que a maioria dos praticantes tem.\n\nNa prática: uma repetição com técnica correta — amplitude completa, controle excêntrico, ativação do músculo-alvo — é mais eficaz para hipertrofia do que 3 repetições com técnica descuidada.'
      },
      {
        icon:'🦵',
        title:'Agachamento: a biomecânica que protege os joelhos',
        text:'O agachamento livre é frequentemente demonizado como "prejudicial aos joelhos". A evidência científica diz o contrário: quando bem executado, o agachamento profundo (abaixo de 90°) fortalece cartilagem, ligamentos e tendões do joelho — desde que a mecânica seja correta.\n\nOs estudos de eletromiografia mostram que o valgo dinâmico (joelhos caindo para dentro durante o agachamento) é a principal causa de lesão patelofemoral e do ligamento cruzado anterior em agachadores. Isso não é fraqueza de joelho — é fraqueza do glúteo médio, que não consegue manter o alinhamento do fêmur.\n\nCorreção evidence-based: fortalecer glúteo médio (abdução de quadril, monster walks com elástico) antes de progredir carga no agachamento. Trabalhamos exatamente isso no módulo 1.'
      },
      {
        icon:'💪',
        title:'Supino: como maximizar a ativação do peitoral',
        text:'Estudos de EMG (eletromiografia) mostram que a ativação do peitoral no supino varia enormemente conforme a técnica. Os fatores com maior impacto: ângulo dos cotovelos em relação ao tronco (45-75° maximiza peitoral; 90° recruta mais deltóide anterior), retração escapular (escápulas retraídas e deprimidas aumentam a base de apoio e o pré-estiramento do peitoral), e amplitude de movimento (descer até tocar o peito dobra a ativação comparado a amplitude parcial).\n\nUm erro técnico que poucos percebem: deixar os cotovelos "afundarem" durante a descida (rotação interna do ombro) coloca o manguito rotador em posição de alta tensão — causa frequente de tendinite em levantadores.\n\nAs correções específicas que ensinamos: posicionamento das mãos, ângulo do banco, arco da coluna seguro, path da barra, e o "corkscrew" de ativação dos ombros antes de descer.'
      },
      {
        icon:'📐',
        title:'Padrões de movimento fundamentais: a chave para treinar com segurança e eficácia',
        text:'O NSCA (National Strength and Conditioning Association) classifica os movimentos fundamentais do treinamento em 7 padrões: empurrar horizontal, empurrar vertical, puxar horizontal, puxar vertical, agachar, dobradiça de quadril e carregar. Dominar esses padrões com qualidade de movimento é a base para treinar com segurança em qualquer nível.\n\nPor que isso importa: a maioria das lesões na academia não acontece nos exercícios avançados — acontece nos exercícios básicos feitos com padrão de movimento inadequado. Um agachamento com má mecânica de tornozelo, ou uma remada com rotação excessiva da lombar, acumula microtraumas ao longo de meses antes de virar uma lesão séria.\n\nEste curso cobre todos os 7 padrões, com análise dos erros mais comuns em cada um e as correções específicas baseadas em avaliação funcional do movimento (FMS - Functional Movement Screen).'
      }
    ]
  },
  {
    id:'nutrition',
    title:'Nutrição para Performance',
    subtitle:'Guia completo · E-book + Vídeos',
    category:'videos',
    tag:'E-BOOK',tagColor:'#2ecc71',
    price:14.99, priceLabel:'R$14,99',
    img:'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=85',
    emoji:'🥗', color:'#27ae60',
    desc:'Tudo que você precisa saber sobre nutrição esportiva baseada em evidências: macronutrientes, timing, suplementação com provas científicas e cardápios práticos.',
    highlights:['E-book 80 páginas','10 vídeos explicativos','Cardápio semanal','Guia de suplementação'],
    episodes:[
      {n:1,title:'Parte 1: Macronutrientes',dur:'3 vídeos'},
      {n:2,title:'Parte 2: Timing Nutricional',dur:'3 vídeos'},
      {n:3,title:'Parte 3: Suplementação',dur:'2 vídeos'},
      {n:4,title:'Parte 4: Cardápios Práticos',dur:'2 vídeos'},
    ],
    mpLink:'https://mpago.la/22dn7UY',
    content:[
      {
        icon:'🔬',
        title:'Proteína: a ciência por trás da recomendação',
        text:'A posição oficial da International Society of Sports Nutrition (ISSN, 2022) — a principal organização científica de nutrição esportiva — recomenda 1,6 a 2,2g de proteína por kg de peso corporal para maximizar a hipertrofia muscular. Para objetivos de emagrecimento com preservação de músculo, a recomendação sobe para 2,0 a 2,4g/kg.\n\nUm dado crítico que a maioria ignora: existe um teto de síntese proteica por refeição. Metanálises mostram que doses acima de 40g de proteína em uma única refeição não produzem síntese proteica adicional no músculo — o excesso é oxidado. Distribuir a proteína em 4 a 5 refeições de 30 a 40g cada é 30% mais eficiente que consumir a mesma quantidade em 1 a 2 refeições.\n\nFontes com maior escore de aminoácidos essenciais (DIAAS — o marcador mais preciso de qualidade proteica): whey protein (1,25), ovos (1,13), leite (1,22), frango (1,08) — superiores a fontes vegetais na maioria dos casos.'
      },
      {
        icon:'⚡',
        title:'Carboidratos: o combustível que você não deve cortar',
        text:'A dieta low carb ganhou popularidade para emagrecimento — mas tem um custo no desempenho atlético que a ciência documenta claramente. O glicogênio muscular é o principal combustível para exercícios acima de 65% do VO₂ máximo (praticamente qualquer treino de academia ou corrida).\n\nEstudos de depleção de glicogênio mostram que quando os estoques caem abaixo de 50%, a performance de força reduz em 15 a 20%, o tempo até a exaustão em exercício aeróbico cai em 25 a 35%, e o risco de lesão aumenta (fadiga muscular compromete a propriocepção e o controle motor).\n\nPara quem treina 4 a 5 vezes por semana, a recomendação atual da ACSM é de 3 a 5g de carboidrato por kg/dia. Cortar carboidrato enquanto treina intensamente é como tentar dirigir uma Ferrari com o tanque vazio — o carro está lá, mas não vai a lugar nenhum.'
      },
      {
        icon:'💊',
        title:'Suplementação: o que funciona, o que não funciona',
        text:'O mercado de suplementos movimenta bilhões — com evidências inversamente proporcionais ao preço. Um resumo honesto baseado no nível de evidência científica:\n\n✅ COMPROVADO — Creatina monohidratada: mais de 500 estudos. Aumenta força em 5-15%, hipertrofia em 5-10%, melhora recuperação. 3-5g/dia. Não precisa de fase de carga. R$30-60/mês.\n\n✅ COMPROVADO — Cafeína: melhora performance aeróbica e de força em 3-11%. 200-400mg, 30-60 min antes. R$0,50/treino (café).\n\n✅ COMPROVADO — Proteína em pó (whey, caseína, vegana): conveniência proteica. Funciona como qualquer proteína alimentar. Nenhum poder "mágico".\n\n❌ EVIDÊNCIA FRACA — BCAAs: inúteis se a ingestão proteica total é adequada. A proteína completa contém mais BCAAs que qualquer suplemento de BCAA.\n\n❌ EVIDÊNCIA FRACA — Termogênicos: efeito de 50-100 kcal/dia no máximo, com potencial risco cardiovascular. Não justificam o custo.'
      },
      {
        icon:'🍽️',
        title:'Timing nutricional: quando comer importa (e quando não importa)',
        text:'A "janela anabólica" pós-treino — a ideia de que você precisa comer proteína dentro de 30 minutos após treinar ou "perderá os ganhos" — foi amplamente exagerada. Pesquisas de Schoenfeld e Aragon (2013, revisado 2018) mostram que a janela é muito mais longa: de 2 a 5 horas pós-treino.\n\nO que realmente importa no timing: o pré-treino. Treinar em jejum ou com glicogênio baixo compromete a performance — e menos intensidade no treino significa menos estímulo para adaptação. Uma refeição completa 2 a 3 horas antes do treino (proteína + carboidrato + gordura moderada) ou um snack leve 30 a 60 minutos antes (banana + whey, por exemplo) otimiza a performance.\n\nPara emagrecimento: a distribuição calórica ao longo do dia importa mais que o timing específico. Comer a maioria das calorias à noite não é inerentemente problemático — o que importa é o total do dia.'
      }
    ]
  },
];

// ── RENDER HOME PROGRAMS (poster cards) ──
const PROGRAM_IMAGES = {
  hypertrophy: 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&q=85',
  elderly:     'https://images.unsplash.com/photo-1658314755561-389d5660ee54?w=400&q=85',
  pregnancy:   'https://images.unsplash.com/photo-1616279969856-759f316a5ac1?w=400&q=85',
  disabled:    'https://images.unsplash.com/photo-1576678927484-cc907957088c?w=400&q=85',
  fatburn:     'https://images.unsplash.com/photo-1538805060514-97d9cc17730c?w=400&q=85',
  running10k:  'https://images.unsplash.com/photo-1461897104016-0b3b00cc81ee?w=400&q=85',
  posture:     'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=400&q=85',
  stress:      'https://images.unsplash.com/photo-1545389336-cf090694435e?w=400&q=85',
  technique:   'https://images.unsplash.com/photo-1599058917212-d750089bc07e?w=400&q=85',
  nutrition:   'https://images.unsplash.com/photo-1547592180-85f173990554?w=400&q=85',
};

function posterCard(p, u){
  const owned = (u?.purchases||[]).includes(p.id) || u?.pacoteEbooks;
  const img = PROGRAM_IMAGES[p.id] || p.img;
  const badge = owned
    ? `<div class="poster-card-owned">✅ Seu</div>`
    : `<div class="poster-card-new">${p.tag}</div>`;
  const lock = owned ? '' : `<div class="poster-card-lock">🔒 ${p.priceLabel}</div>`;

  return `<div class="poster-card" onclick="openMovie('${p.id}')">
    <img src="${img}" class="poster-card-img" alt="${p.title}"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/>
    <div class="poster-card-bg" style="display:none;background:linear-gradient(135deg,${p.color}55,#000)">
      <div class="poster-card-emoji">${p.emoji}</div>
    </div>
    ${badge}
    ${lock}
    <div class="poster-card-footer">
      <div class="poster-card-tag" style="color:${p.tagColor}">${p.tag}</div>
      <div class="poster-card-title">${p.title}</div>
      <div class="poster-card-sub">${p.subtitle}</div>
    </div>
  </div>`;
}

function renderHomePrograms(u){try{
  // Featured: specialized programs
  const featured = CATALOG.filter(p=>['hypertrophy','elderly','pregnancy','disabled'].includes(p.id));
  const featEl = document.getElementById('home-programs-carousel');
  if(featEl) featEl.innerHTML = featured.map(p=>posterCard(p,u)).join('');

  // Destaques da loja
  const popular = CATALOG.slice(0,6);
  const popEl = document.getElementById('home-popular-carousel');
  if(popEl) popEl.innerHTML = popular.map(p=>posterCard(p,u)).join('');
  }catch(e){console.error('renderHomePrograms error:',e);}
}

// ── RENDER STORE ──
function renderStore(u){try{
  const cats = {
    specialized:'store-specialized',
    weight:'store-weight',
    health:'store-health',
    videos:'store-videos'
  };
  Object.entries(cats).forEach(([cat, elId])=>{
    const el = document.getElementById(elId);
    if(!el) return;
    const items = CATALOG.filter(p=>p.category===cat);
    el.innerHTML = items.map(p=>movieCard(p,u)).join('');
  });
  }catch(e){console.error('renderStore error:',e);}
}

function movieCard(p, u){
  const owned = (u?.purchases||[]).includes(p.id) || (u?.trainApproved && p.id==='free') || u?.pacoteEbooks;
  const lock = owned ? '' : `<div class="movie-card-locked">🔒 ${p.priceLabel}</div>`;
  const badge = `<div class="movie-card-badge" style="background:${p.tagColor}">${p.tag}</div>`;
  return `<div class="movie-card" onclick="openMovie('${p.id}')">
    <div class="movie-card-poster-bg" style="background:linear-gradient(135deg,${p.color}33,#000)">
      <img src="${p.img}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.5)"/>
      <div style="position:relative;z-index:1;text-align:center">
        <div style="font-size:48px;margin-bottom:6px">${p.emoji}</div>
        <div style="font-size:11px;font-weight:900;color:#fff;padding:0 8px;text-align:center;line-height:1.2">${p.title}</div>
      </div>
      ${badge}${lock}
    </div>
    <div class="movie-card-info">
      <div class="movie-card-title">${p.title}</div>
      <div class="movie-card-sub">${p.subtitle}</div>
      <div class="movie-card-price">${owned?'✅ Disponível':p.priceLabel}</div>
    </div>
  </div>`;
}

function openMovie(id){
  const p = CATALOG.find(c=>c.id===id);
  if(!p) return;
  const u = getU();
  const owned = (u?.purchases||[]).includes(p.id);

  document.getElementById('movie-hero-img').src = p.img;
  const body = document.getElementById('movie-modal-body');

  const highlightsHtml = p.highlights.map(h=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--b)">
      <span style="color:var(--r);font-size:14px">✓</span>
      <span style="font-size:13px">${h}</span>
    </div>`).join('');

  // ── Content articles ──
  const contentHtml = (p.content||[]).map(c=>`
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:16px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:36px;height:36px;border-radius:10px;background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.15);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">${c.icon}</div>
        <div style="font-size:14px;font-weight:800">${c.title}</div>
      </div>
      <div style="font-size:13px;color:var(--t2);line-height:1.75;white-space:pre-line">${c.text}</div>
    </div>
  `).join('');

  const episodesHtml = p.episodes.map((e,i)=>`
    <div class="episode-row">
      <div class="${owned?'episode-num':'episode-locked'}">${owned?(i+1):'🔒'}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;${!owned?'color:var(--mu)':''}">${e.title}</div>
        <div style="font-size:10px;color:var(--mu);margin-top:2px">${e.dur}</div>
      </div>
      ${owned?`<span style="font-size:16px;color:var(--mu)">›</span>`:''}
    </div>`).join('');

  body.innerHTML = `
    <div style="display:inline-block;border-radius:4px;padding:2px 9px;font-size:9px;font-weight:900;letter-spacing:1px;margin-bottom:8px;background:${p.tagColor}">${p.tag}</div>
    <div style="font-size:24px;font-weight:900;margin-bottom:4px;line-height:1.1">${p.title}</div>
    <div style="font-size:12px;color:var(--t2);margin-bottom:12px">${p.subtitle}</div>

    <!-- Selo -->
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
      <span style="font-size:11px;color:var(--mu)">🧠 Método Rennan Dias · baseado em evidências</span>
      ${owned?'<span style="background:rgba(46,204,113,.1);border:1px solid rgba(46,204,113,.2);border-radius:6px;padding:2px 10px;font-size:10px;font-weight:800;color:#2ecc71">✅ Você tem acesso</span>':''}
    </div>

    <!-- Descrição -->
    <p style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:16px">${p.desc}</p>

    <!-- O que você aprende -->
    <div style="font-size:10px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">O que está incluído</div>
    <div style="margin-bottom:16px">${highlightsHtml}</div>

    <!-- Episódios/Módulos -->
    <div style="font-size:10px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:4px">
      ${p.category==='videos'?'Módulos':'Etapas do programa'}
    </div>
    <div style="margin-bottom:20px">${episodesHtml}</div>

    <!-- Conteúdo educacional -->
    ${contentHtml ? `<div style="font-size:10px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px">📚 Conteúdo do programa</div>${contentHtml}` : ''}

    <!-- CTA -->
    ${owned
      ? `<button class="btn-p" onclick="openEbook('${p.id}')">📖 Acessar E-Book</button>`
      : `<div style="background:rgba(229,9,20,.06);border:1px solid rgba(229,9,20,.15);border-radius:12px;padding:14px;margin-bottom:12px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:var(--r);margin-bottom:2px">${p.priceLabel}</div>
          <div style="font-size:11px;color:var(--mu)">Pagamento único · Acesso vitalício</div>
        </div>
        <button class="btn-p" onclick="openIntake('${p.id}')">🛒 Comprar agora — ${p.priceLabel}</button>
        <button onclick="closeModal('modal-movie')" style="width:100%;padding:12px;background:transparent;border:1px solid var(--b);border-radius:12px;color:var(--t2);font-size:13px;font-weight:700;cursor:pointer;margin-top:8px">Continuar navegando</button>`
    }
    <div style="height:8px"></div>
  `;
  abrirModal('modal-movie');
}

function buyProgram(id, link){
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  if(users[email]){
    if(!users[email].pendingPurchases) users[email].pendingPurchases=[];
    if(!users[email].pendingPurchases.includes(id)) users[email].pendingPurchases.push(id);
    DB.set('fq_users', users);
  }
  fqCheckout(id, link||'https://mpago.la/22dn7UY');
}

// Admin: liberar programa manualmente (ex.: venda por fora / cortesia)
async function admGrantProgram(email, programId){
  const users = DB.get('fq_users')||{};
  const st=(window.ADM_CACHE||[]).find(a=>a.email===email);
  const atual=st?(st.purchases||[]):((users[email]&&users[email].purchases)||[]);
  const novas=[...new Set([...atual,programId])];
  if(users[email]){users[email].purchases=novas;users[email].pacoteEbooks=novas.length>=10;DB.set('fq_users',users);}
  if(sb) await sb.from('alunos').update({purchases:novas,pacote_ebooks:novas.length>=10}).eq('email',email);
  if(window.ADM_CACHE){const s=window.ADM_CACHE.find(a=>a.email===email);if(s){s.purchases=novas;s.pacoteEbooks=novas.length>=10;}}
}

async function admRevokeProgram(email, programId){
  const users = DB.get('fq_users')||{};
  const st=(window.ADM_CACHE||[]).find(a=>a.email===email);
  const atual=st?(st.purchases||[]):((users[email]&&users[email].purchases)||[]);
  const novas=atual.filter(p=>p!==programId);
  if(users[email]){users[email].purchases=novas;users[email].pacoteEbooks=false;DB.set('fq_users',users);}
  if(sb) await sb.from('alunos').update({purchases:novas,pacote_ebooks:false}).eq('email',email);
  if(window.ADM_CACHE){const s=window.ADM_CACHE.find(a=>a.email===email);if(s){s.purchases=novas;s.pacoteEbooks=false;}}
}

const ADM_EBOOK_TITULOS={
  hypertrophy:'Hipertrofia Máxima', elderly:'Treino 60+', pregnancy:'Gravidez Ativa',
  disabled:'Movimento Livre', fatburn:'Emagrecimento Total', running10k:'Do Zero ao 10km',
  posture:'Postura e Mobilidade', stress:'Treino Anti-Estresse', technique:'Técnica Perfeita',
  nutrition:'Nutrição para Performance'
};

function openEbooksAdmin(email){
  const users = DB.get('fq_users')||{};
  const st=(window.ADM_CACHE||[]).find(a=>a.email===email) || users[email];
  if(!st){fqToast('Aluno não encontrado','warn');return;}
  const purchases = st.purchases||[];
  document.getElementById('modal-ebooksadm-name').textContent = '📚 E-Books — ' + (st.name||email);
  document.getElementById('modal-ebooksadm-content').innerHTML = `
    <div style="font-size:11px;color:var(--mu);margin-bottom:12px">Toque para liberar ou trancar cada e-book individualmente</div>
    ${Object.entries(ADM_EBOOK_TITULOS).map(([id,titulo])=>{
      const on = purchases.includes(id);
      return `<div style="display:flex;align-items:center;justify-content:space-between;background:var(--s);border:1px solid var(--b);border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="font-size:12.5px;font-weight:700">${titulo}</div>
        <button onclick="admToggleEbook('${email}','${id}',this)" data-on="${on}" style="width:46px;height:26px;border-radius:14px;border:none;cursor:pointer;position:relative;background:${on?'#2ecc71':'var(--s2)'};transition:background .2s">
          <div style="position:absolute;top:2px;left:${on?'22px':'2px'};width:22px;height:22px;border-radius:50%;background:#fff;transition:left .2s"></div>
        </button>
      </div>`;
    }).join('')}
    <button class="btn-p" style="margin-top:8px" onclick="admGiveAllEbooks('${email}');closeEbooksAdmin();">📚 Liberar todos de uma vez</button>
  `;
  abrirModal('modal-ebooksadm');
}

async function admToggleEbook(email, programId, btn){
  const isOn = btn.getAttribute('data-on')==='true';
  btn.disabled=true;
  if(isOn) await admRevokeProgram(email, programId);
  else await admGrantProgram(email, programId);
  btn.setAttribute('data-on', (!isOn).toString());
  btn.style.background = !isOn ? '#2ecc71' : 'var(--s2)';
  btn.querySelector('div').style.left = !isOn ? '22px' : '2px';
  btn.disabled=false;
  fqToast(!isOn ? '✅ E-book liberado' : '🔒 E-book trancado', 'ok');
}

function closeEbooksAdmin(){
  closeModal('modal-ebooksadm');
  loadAdmin();
}

// ══ PROGRAM INTAKE — PERSONALIZAÇÃO COM IA ══

const INTAKE_QUESTIONS = {
  hypertrophy:[
    {
      id:'nivel', type:'single',
      q:'Qual é seu nível atual de treino?',
      hint:'Seja honesto — isso garante que o programa seja ideal para você.',
      opts:[
        {icon:'🌱',label:'Intermediário',sub:'6 meses a 2 anos de musculação'},
        {icon:'💪',label:'Avançado',sub:'Mais de 2 anos, treino consistente'},
        {icon:'🏆',label:'Muito avançado',sub:'3+ anos, já usei técnicas avançadas'},
      ]
    },
    {
      id:'foco', type:'multi',
      q:'Quais grupos musculares você quer priorizar?',
      hint:'Selecione até 2 — a periodização vai dar ênfase neles.',
      opts:['💪 Peito','🦅 Costas','🦵 Pernas','🔴 Ombros','💉 Braços','🎯 Core/Abdômen']
    },
    {
      id:'fraqueza', type:'single',
      q:'Qual é seu maior desafio atual?',
      hint:'Isso vai guiar a IA na escolha dos exercícios.',
      opts:[
        {icon:'📉',label:'Platô — parei de evoluir',sub:'Mesma carga há mais de 1 mês'},
        {icon:'⚡',label:'Falta de intensidade',sub:'Termino os treinos sem estar cansado'},
        {icon:'😴',label:'Recuperação lenta',sub:'Dores musculares que demoram muito'},
        {icon:'🎯',label:'Técnica imperfeita',sub:'Não sinto o músculo certo no exercício'},
      ]
    },
    {
      id:'tempo', type:'single',
      q:'Quanto tempo você tem por sessão?',
      hint:'O volume e número de exercícios serão adaptados.',
      opts:[
        {icon:'⚡',label:'Até 60 minutos',sub:'Treinos compactos e eficientes'},
        {icon:'💪',label:'60 a 90 minutos',sub:'Volume moderado-alto'},
        {icon:'🏆',label:'Mais de 90 minutos',sub:'Volume máximo, técnicas avançadas'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Alguma observação importante?',
      hint:'Lesões, restrições, objetivos específicos — qualquer detalhe ajuda.',
      placeholder:'Ex: tenho dor no ombro direito, quero foco em pernas, treino às 6h da manhã...'
    }
  ],

  elderly:[
    {
      id:'idade', type:'single',
      q:'Qual é a sua faixa etária?',
      hint:'A intensidade e os exercícios serão ajustados para a sua faixa.',
      opts:[
        {icon:'🌟',label:'60 a 65 anos',sub:'Ativo e com boa mobilidade'},
        {icon:'💪',label:'66 a 72 anos',sub:'Alguma limitação natural'},
        {icon:'❤️',label:'73 a 80 anos',sub:'Foco em funcionalidade e segurança'},
        {icon:'🌿',label:'Acima de 80 anos',sub:'Exercícios adaptados e supervisionados'},
      ]
    },
    {
      id:'atividade', type:'single',
      q:'Como está sua atividade física atual?',
      hint:'Isso define nosso ponto de partida.',
      opts:[
        {icon:'🪑',label:'Sedentário',sub:'Pouca ou nenhuma atividade física'},
        {icon:'🚶',label:'Caminhadas leves',sub:'Caminho alguns dias por semana'},
        {icon:'🏊',label:'Ativo ocasional',sub:'Faço alguma atividade às vezes'},
        {icon:'💪',label:'Já treino regularmente',sub:'Academia ou exercícios em casa'},
      ]
    },
    {
      id:'dores', type:'multi',
      q:'Tem dor ou limitação em alguma região?',
      hint:'Todos os exercícios dessas regiões serão adaptados ou substituídos.',
      opts:['🦵 Joelho','🔵 Lombar / Coluna','💪 Ombro','🦴 Quadril','🦶 Tornozelo','❤️ Problema cardíaco','Nenhuma limitação']
    },
    {
      id:'objetivo', type:'single',
      q:'Qual é o seu principal objetivo?',
      hint:'Vamos direcionar o programa para o que mais importa para você.',
      opts:[
        {icon:'🦵',label:'Força e equilíbrio',sub:'Prevenir quedas e ganhar independência'},
        {icon:'❤️',label:'Saúde cardiovascular',sub:'Melhorar disposição e resistência'},
        {icon:'🏃',label:'Mobilidade',sub:'Mexer com mais facilidade no dia a dia'},
        {icon:'😊',label:'Bem-estar geral',sub:'Me sentir melhor e ter mais energia'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Medicamentos ou condições de saúde que devo saber?',
      hint:'Nenhuma informação é compartilhada com terceiros — é apenas para personalizar seu treino.',
      placeholder:'Ex: tomo losartana, tenho diabetes tipo 2, fiz cirurgia no joelho em 2022...'
    }
  ],

  pregnancy:[
    {
      id:'trimestre', type:'single',
      q:'Em que fase da gravidez você está?',
      hint:'O programa é completamente diferente em cada trimestre.',
      opts:[
        {icon:'🌱',label:'1º Trimestre',sub:'Até a 13ª semana'},
        {icon:'💪',label:'2º Trimestre',sub:'14ª a 27ª semana — melhor fase para treinar'},
        {icon:'🌸',label:'3º Trimestre',sub:'28ª semana em diante'},
        {icon:'💫',label:'Pós-parto',sub:'Recuperação após o nascimento'},
      ]
    },
    {
      id:'experiencia', type:'single',
      q:'Você praticava exercícios antes da gravidez?',
      hint:'Isso determina a intensidade inicial do seu programa.',
      opts:[
        {icon:'🌱',label:'Não praticava',sub:'Sou iniciante em exercícios'},
        {icon:'🚶',label:'Atividade leve',sub:'Caminhadas e atividades leves'},
        {icon:'💪',label:'Treinava regularmente',sub:'Academia ou esporte 3+ vezes/semana'},
        {icon:'🏆',label:'Atleta',sub:'Treino intenso e competitivo'},
      ]
    },
    {
      id:'liberacao', type:'single',
      q:'Você tem liberação médica para se exercitar?',
      hint:'Importante: sempre consulte seu obstetra antes de iniciar.',
      opts:[
        {icon:'✅',label:'Sim, médico liberou',sub:'Tenho autorização do meu obstetra'},
        {icon:'⏳',label:'Ainda não consultei',sub:'Vou consultar antes de começar'},
        {icon:'⚠️',label:'Tenho restrições',sub:'Médico orientou sobre limitações'},
      ]
    },
    {
      id:'sintomas', type:'multi',
      q:'Tem algum desses sintomas ou condições?',
      hint:'Exercícios específicos serão adaptados ou removidos.',
      opts:['🤢 Náusea frequente','😴 Fadiga intensa','💧 Inchaço nos pés','🩺 Pressão alta','🩸 Anemia','Nenhum dos anteriores']
    },
    {
      id:'obs', type:'text',
      q:'Algo mais que devo saber sobre sua gravidez?',
      hint:'Qualquer detalhe que ajude a tornar o programa mais seguro e eficaz para você.',
      placeholder:'Ex: gestação gemelar, cesárea anterior, diastase abdominal, enjoos matinais...'
    }
  ],

  disabled:[
    {
      id:'tipo', type:'single',
      q:'Qual é o tipo de deficiência ou limitação?',
      hint:'O programa terá adaptações específicas para sua condição.',
      opts:[
        {icon:'♿',label:'Cadeirante',sub:'Uso cadeira de rodas permanentemente'},
        {icon:'🦿',label:'Amputação',sub:'Membro amputado'},
        {icon:'🦯',label:'Deficiência visual',sub:'Baixa visão ou cegueira'},
        {icon:'🩺',label:'Limitação motora',sub:'Paralisia parcial, hemiplegia, etc.'},
        {icon:'🤝',label:'Outra condição',sub:'Doença neuromuscular ou outra limitação'},
      ]
    },
    {
      id:'nivel', type:'single',
      q:'Como você descreveria sua capacidade física atual?',
      hint:'Sem julgamentos — isso apenas define nosso ponto de partida.',
      opts:[
        {icon:'🌱',label:'Muito limitado',sub:'Poucos movimentos independentes'},
        {icon:'💪',label:'Parcialmente independente',sub:'Consigo fazer muitas coisas com adaptação'},
        {icon:'🏆',label:'Bastante independente',sub:'Limitação específica mas alta autonomia'},
      ]
    },
    {
      id:'objetivo', type:'multi',
      q:'O que você quer conquistar com este programa?',
      hint:'Pode marcar mais de um — o programa vai equilibrar as prioridades.',
      opts:['💪 Ganhar força','🏃 Mais resistência','🎯 Independência no dia a dia','😊 Bem-estar e humor','⚖️ Controle do peso','🦴 Saúde cardiovascular']
    },
    {
      id:'equipamento', type:'single',
      q:'Quais equipamentos você tem acesso?',
      hint:'Os exercícios serão adaptados para o que você tem disponível.',
      opts:[
        {icon:'🏢',label:'Academia adaptada',sub:'Equipamentos e profissional disponíveis'},
        {icon:'🏠',label:'Casa com halteres/elásticos',sub:'Equipamentos básicos em casa'},
        {icon:'🪑',label:'Apenas corpo/cadeira',sub:'Sem equipamentos adicionais'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Detalhes sobre sua condição que ajudarão a personalizar o treino:',
      hint:'Quanto mais detalhes, mais personalizado e seguro será seu programa.',
      placeholder:'Ex: amputação transtibial direita com prótese, boa mobilidade no membro residual, treino há 2 anos...'
    }
  ],

  fatburn:[
    {
      id:'historico', type:'single',
      q:'Você já tentou emagrecer antes?',
      hint:'Seu histórico nos diz muito sobre o que vai funcionar para você.',
      opts:[
        {icon:'🌱',label:'É minha primeira tentativa séria',sub:'Quero fazer certo desta vez'},
        {icon:'🔄',label:'Já tentei, mas abandonei',sub:'Tive dificuldade de manter a consistência'},
        {icon:'📉',label:'Emagreci mas voltou o peso',sub:'Efeito sanfona — quero resultado duradouro'},
        {icon:'💪',label:'Perdi algum peso mas travei',sub:'Platô — preciso de novo estímulo'},
      ]
    },
    {
      id:'obstaculo', type:'single',
      q:'Qual é seu maior obstáculo para emagrecer?',
      hint:'A IA vai criar estratégias específicas para seu desafio.',
      opts:[
        {icon:'🍕',label:'Alimentação',sub:'Dificuldade de manter a dieta'},
        {icon:'⏰',label:'Falta de tempo',sub:'Rotina corrida e imprevisível'},
        {icon:'😴',label:'Cansaço e estresse',sub:'Sem energia para treinar'},
        {icon:'🎯',label:'Falta de consistência',sub:'Começo bem mas não mantenho'},
      ]
    },
    {
      id:'disponibilidade', type:'single',
      q:'Quantos dias por semana você consegue treinar?',
      hint:'Seja realista — consistência é melhor que perfeição.',
      opts:[
        {icon:'3️⃣',label:'3 dias por semana',sub:'Mínimo eficaz para emagrecimento'},
        {icon:'4️⃣',label:'4 dias por semana',sub:'Ótimo equilíbrio'},
        {icon:'5️⃣',label:'5 dias por semana',sub:'Alta frequência para resultados rápidos'},
      ]
    },
    {
      id:'restricoes', type:'multi',
      q:'Tem alguma restrição alimentar ou de saúde?',
      hint:'O programa nutricional será adaptado para você.',
      opts:['🌿 Vegetariano/vegano','🌾 Intolerância ao glúten','🥛 Intolerância à lactose','💊 Diabetes','❤️ Problema cardíaco','Nenhuma restrição']
    },
    {
      id:'obs', type:'text',
      q:'Qual é a sua meta de emagrecimento?',
      hint:'Metas específicas ajudam a IA a calibrar a progressão.',
      placeholder:'Ex: quero perder 10kg em 3 meses, preciso caber no vestido do casamento, quero reduzir a barriga...'
    }
  ],

  running10k:[
    {
      id:'nivel', type:'single',
      q:'Como está sua corrida hoje?',
      hint:'Vamos do seu ponto atual até os 10km.',
      opts:[
        {icon:'🚶',label:'Não consigo correr 1 minuto seguido',sub:'Zero — começo do absoluto zero'},
        {icon:'🏃',label:'Consigo correr 5 a 10 minutos',sub:'Base aeróbica inicial'},
        {icon:'💪',label:'Já corro 2 a 3km sem parar',sub:'Preciso aumentar a distância'},
        {icon:'🎯',label:'Já corro 5km mas quero 10km',sub:'Preciso dobrar a distância'},
      ]
    },
    {
      id:'lesao', type:'multi',
      q:'Já teve alguma lesão relacionada à corrida?',
      hint:'Exercícios preventivos serão priorizados.',
      opts:['🦵 Dor no joelho','🦶 Canelite','🦷 Fascite plantar','🏃 Banda iliotibial','😊 Nunca tive lesão']
    },
    {
      id:'objetivo', type:'single',
      q:'Qual é seu objetivo com a corrida?',
      hint:'Isso define o ritmo e a intensidade do programa.',
      opts:[
        {icon:'🏅',label:'Completar um 10km',sub:'Só quero cruzar a linha de chegada'},
        {icon:'⏱️',label:'Completar em menos de 1 hora',sub:'Meta de tempo — pace de 6 min/km'},
        {icon:'❤️',label:'Saúde e condicionamento',sub:'Quero me sentir melhor, não competir'},
        {icon:'🏆',label:'Preparar para uma prova',sub:'Tenho uma corrida marcada'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Algum detalhe importante para seu programa?',
      hint:'Quanto mais soubermos, melhor será seu treino.',
      placeholder:'Ex: treino às manhãs, tenho uma prova em Setembro, moro em apartamento sem pista...'
    }
  ],

  posture:[
    {
      id:'dor', type:'multi',
      q:'Onde você sente dor ou desconforto?',
      hint:'O programa vai priorizar as regiões mais afetadas.',
      opts:['🔵 Lombar (costas baixas)','🔵 Cervical (pescoço)','💪 Ombros','🏠 Entre as escápulas','🦵 Quadril','😊 Não sinto dor — quero prevenir']
    },
    {
      id:'causa', type:'single',
      q:'Qual é sua rotina principal?',
      hint:'O programa será adaptado para compensar os padrões do seu dia a dia.',
      opts:[
        {icon:'💻',label:'Trabalho sentado o dia todo',sub:'Home office ou escritório'},
        {icon:'📱',label:'Muito tempo no celular',sub:'Pescoço sempre inclinado'},
        {icon:'🏗️',label:'Trabalho físico / em pé',sub:'Esforço repetitivo ou postura estática'},
        {icon:'🔄',label:'Combinação de tudo',sub:'Muito variado'},
      ]
    },
    {
      id:'historico', type:'single',
      q:'Já fez fisioterapia ou tratamento postural?',
      hint:'Isso nos ajuda a calibrar a dificuldade inicial.',
      opts:[
        {icon:'❌',label:'Nunca fiz',sub:'Primeira abordagem sistemática'},
        {icon:'✅',label:'Fiz e melhorei bastante',sub:'Quero manutenção e progressão'},
        {icon:'🔄',label:'Fiz mas a dor voltou',sub:'Preciso de rotina consistente'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Detalhes adicionais sobre sua postura ou dores:',
      hint:'Diagnósticos, exames ou observações do médico/fisioterapeuta são muito úteis.',
      placeholder:'Ex: diagnóstico de hiperlordose, escoliose leve, hérnia de disco L4-L5, dor ao sentar por mais de 1 hora...'
    }
  ],

  stress:[
    {
      id:'nivel', type:'single',
      q:'Como você descreveria seu nível de estresse?',
      hint:'Sem julgamentos — isso calibra a intensidade dos treinos.',
      opts:[
        {icon:'😐',label:'Estresse moderado',sub:'Tenso às vezes, mas consigo descansar'},
        {icon:'😰',label:'Estresse alto',sub:'Tenso quase sempre, sono ruim'},
        {icon:'😤',label:'Estresse muito alto',sub:'Exaustão constante, possível burnout'},
      ]
    },
    {
      id:'sono', type:'single',
      q:'Como está a qualidade do seu sono?',
      hint:'O sono é parte fundamental do programa anti-estresse.',
      opts:[
        {icon:'😴',label:'Durmo bem',sub:'7 a 8 horas com qualidade'},
        {icon:'⚡',label:'Durmo pouco',sub:'Menos de 6 horas por noite'},
        {icon:'🌀',label:'Durmo mas não descanso',sub:'Acordo cansado, sono superficial'},
        {icon:'🌙',label:'Insônia frequente',sub:'Dificuldade de dormir ou manter o sono'},
      ]
    },
    {
      id:'preferencia', type:'single',
      q:'O que mais te atrai neste programa?',
      hint:'Vamos enfatizar o que você mais precisa.',
      opts:[
        {icon:'🌬️',label:'Técnicas de respiração',sub:'Controle imediato da ansiedade'},
        {icon:'🧘',label:'Yoga e mobilidade',sub:'Corpo e mente em equilíbrio'},
        {icon:'🏃',label:'Cardio leve e meditativo',sub:'Movimento que acalma'},
        {icon:'💆',label:'Tudo equilibrado',sub:'Quero uma abordagem completa'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'O que está causando mais estresse na sua vida agora?',
      hint:'Isso é confidencial e nos ajuda a personalizar as práticas de mindfulness.',
      placeholder:'Ex: trabalho muito exigente, problemas familiares, ansiedade generalizada, prazo apertado...'
    }
  ],

  technique:[
    {
      id:'foco', type:'multi',
      q:'Quais exercícios você mais quer aprender/corrigir?',
      hint:'As aulas desses exercícios serão priorizadas no seu plano.',
      opts:['🦵 Agachamento','🏋️ Supino','💪 Levantamento terra','🎣 Remada','⬇️ Puxada','🔽 Desenvolvimento','Quero aprender todos']
    },
    {
      id:'problema', type:'single',
      q:'Qual é o seu maior problema técnico atualmente?',
      hint:'A IA vai focar nas correções mais relevantes para você.',
      opts:[
        {icon:'😶',label:'Não sinto o músculo certo',sub:'Executo o movimento mas não sinto ativação'},
        {icon:'⚠️',label:'Tenho dor ao fazer certos exercícios',sub:'A técnica errada está causando dor'},
        {icon:'🌱',label:'Sou iniciante',sub:'Quero aprender do zero, do jeito certo'},
        {icon:'📈',label:'Quero aumentar a carga',sub:'Técnica atual não suporta mais peso'},
      ]
    },
    {
      id:'obs', type:'text',
      q:'Exercícios específicos que geram dúvida ou desconforto:',
      hint:'Detalhe o movimento e onde sente o problema.',
      placeholder:'Ex: no agachamento meus joelhos caem para dentro, no supino sinto mais no ombro que no peito...'
    }
  ],

  nutrition:[
    {
      id:'objetivo', type:'single',
      q:'Qual é seu objetivo nutricional principal?',
      hint:'O guia e os cardápios serão direcionados para sua meta.',
      opts:[
        {icon:'🔥',label:'Emagrecer',sub:'Perda de gordura com preservação muscular'},
        {icon:'💪',label:'Ganhar massa muscular',sub:'Superávit calórico e proteína otimizados'},
        {icon:'⚖️',label:'Recomposição corporal',sub:'Perder gordura e ganhar músculo ao mesmo tempo'},
        {icon:'❤️',label:'Saúde e energia',sub:'Melhorar disposição e qualidade de vida'},
      ]
    },
    {
      id:'dificuldade', type:'single',
      q:'Qual é sua maior dificuldade com a alimentação?',
      hint:'A IA vai oferecer estratégias específicas para seu desafio.',
      opts:[
        {icon:'🍕',label:'Como mal nos fins de semana',sub:'Semana boa, fim de semana péssimo'},
        {icon:'⏰',label:'Não tenho tempo para cozinhar',sub:'Dependência de delivery e fast food'},
        {icon:'🎯',label:'Não sei calcular minha dieta',sub:'Não sei quanto e o que comer'},
        {icon:'😤',label:'Ansiedade e compulsão alimentar',sub:'Como por emoção, não por fome'},
      ]
    },
    {
      id:'restricoes', type:'multi',
      q:'Tem restrições ou preferências alimentares?',
      hint:'Os cardápios serão completamente adaptados.',
      opts:['🌿 Vegetariano','🌱 Vegano','🌾 Sem glúten','🥛 Sem lactose','🐟 Não como carne vermelha','Sem restrições']
    },
    {
      id:'obs', type:'text',
      q:'Seus dados para cálculo personalizado:',
      hint:'Quanto mais preciso, mais exato será seu plano nutricional.',
      placeholder:'Ex: 80kg, 1,75m, 32 anos, treino 4x/semana, trabalho sentado, quero perder 10kg...'
    }
  ],
};

// ── INTAKE STATE ──
let intakeState = {
  programId: null,
  currentStep: 0,
  answers: {},
};

function openIntake(programId){
  const p = CATALOG.find(c=>c.id===programId);
  if(!p) return;
  const questions = INTAKE_QUESTIONS[programId]||[];
  if(!questions.length){ buyProgram(programId, p.mpLink); return; }

  intakeState = {programId, currentStep:0, answers:{}};

  document.getElementById('intake-program-name').textContent = p.title.toUpperCase();
  document.getElementById('intake-step-label').textContent = t('anam.building');
  renderIntakeStep(questions);
  abrirModal('modal-intake');
  document.getElementById('modal-movie').classList.remove('open');
}

function renderIntakeStep(questions){
  const step = intakeState.currentStep;
  const q = questions[step];
  const total = questions.length;
  const pct = Math.round((step/total)*100);

  document.getElementById('intake-prog').style.width = pct+'%';
  document.getElementById('intake-step-label').textContent = t('anam.stepcount',{n:step+1,total:total});

  const backBtn = document.getElementById('intake-btn-back');
  const nextBtn = document.getElementById('intake-btn-next');
  backBtn.style.display = step>0?'block':'none';

  const isLast = step===total-1;
  nextBtn.textContent = isLast ? '✅ Gerar meu programa personalizado' : 'Próximo →';

  let html = `<div class="intake-q">${q.q}</div><div class="intake-hint">${q.hint}</div>`;

  if(q.type==='single'){
    html += `<div class="intake-opts" id="intake-opts">`;
    q.opts.forEach((o,i)=>{
      const sel = intakeState.answers[q.id]===o.label;
      html += `<div class="intake-opt ${sel?'sel':''}" onclick="selIntakeSingle('${q.id}',${i})">
        <span class="intake-opt-icon">${o.icon}</span>
        <div><div style="font-size:14px;font-weight:700">${o.label}</div><div style="font-size:11px;color:var(--mu);margin-top:2px">${o.sub||''}</div></div>
      </div>`;
    });
    html += `</div>`;
  } else if(q.type==='multi'){
    const selected = intakeState.answers[q.id]||[];
    html += `<div class="intake-multi-opts" id="intake-opts">`;
    q.opts.forEach((o,i)=>{
      const sel = selected.includes(o);
      html += `<div class="intake-multi-opt ${sel?'sel':''}" onclick="togIntakeMulti('${q.id}','${o.replace(/'/g,"\'")}',this)">${o}</div>`;
    });
    html += `</div>`;
  } else if(q.type==='text'){
    const val = intakeState.answers[q.id]||'';
    html += `<textarea class="fi" id="intake-text-${q.id}" rows="4" placeholder="${q.placeholder||''}" style="font-size:14px">${val}</textarea>`;
  }

  document.getElementById('intake-steps-container').innerHTML = html;
}

function selIntakeSingle(id, idx){
  const questions = INTAKE_QUESTIONS[intakeState.programId];
  const q = questions[intakeState.currentStep];
  intakeState.answers[id] = q.opts[idx].label;
  document.querySelectorAll('.intake-opt').forEach((el,i)=>{
    el.classList.toggle('sel', i===idx);
  });
}

function togIntakeMulti(id, val, el){
  if(!intakeState.answers[id]) intakeState.answers[id]=[];
  const arr = intakeState.answers[id];
  const idx = arr.indexOf(val);
  if(idx>=0){ arr.splice(idx,1); el.classList.remove('sel'); }
  else { arr.push(val); el.classList.add('sel'); }
}

function intakeNext(){
  const questions = INTAKE_QUESTIONS[intakeState.programId];
  const q = questions[intakeState.currentStep];

  // Save text answer if text type
  if(q.type==='text'){
    const el = document.getElementById(`intake-text-${q.id}`);
    if(el) intakeState.answers[q.id] = el.value;
  }

  if(intakeState.currentStep < questions.length-1){
    intakeState.currentStep++;
    renderIntakeStep(questions);
    document.querySelector('#modal-intake .modal-bx').scrollTop=0;
  } else {
    // Last step — generate AI program
    generatePersonalizedProgram();
  }
}

function intakePrev(){
  if(intakeState.currentStep>0){
    intakeState.currentStep--;
    const questions = INTAKE_QUESTIONS[intakeState.programId];
    renderIntakeStep(questions);
  }
}

async function generatePersonalizedProgram(){
  const p = CATALOG.find(c=>c.id===intakeState.programId);
  const u = getU();
  if(!p||!u) return;

  // Show loading screen
  document.getElementById('intake-steps-container').innerHTML = `
    <div class="intake-ai-loading">
      <div style="font-size:48px;margin-bottom:16px">🤖</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:8px">Gerando seu programa personalizado</div>
      <div style="font-size:13px;color:var(--mu);margin-bottom:20px">Analisando suas respostas...</div>
      <div class="intake-ai-dots"><span></span><span></span><span></span></div>
    </div>`;
  document.getElementById('intake-nav').style.display='none';

  // Geração local e instantânea da personalização (sem API externa)
  setTimeout(()=>{
    try{
      const plan = montarPersonalizacao(p, intakeState.answers, u);
      showIntakeResult(plan, p, u);
    }catch(e){
      console.error('Intake local error:', e);
      showIntakeResult(null, p, u);
    }
  }, 1200);
}

// Monta a personalização com base nas respostas da ficha + anamnese
function montarPersonalizacao(p, answers, u){
  const nome = (u.name||'Atleta').split(' ')[0];
  const an = u.anamnese||{};
  const resp = k => answers[k] ? (Array.isArray(answers[k])?answers[k].join(', '):answers[k]) : '';
  const lesoes = (an.lesoes||[]).filter(l=>!/nenhuma/i.test(l));
  const dores = Array.isArray(answers.dores)?answers.dores.filter(d=>!/nenhuma/i.test(d)):[];
  const restricoes = Array.isArray(answers.restricoes)?answers.restricoes.filter(r=>!/nenhuma|sem restri/i.test(r)):[];
  const obsTexto = (answers.obs||'').trim();

  const ajustes = [];
  if(resp('nivel')) ajustes.push({titulo:'Intensidade calibrada para o seu nível', descricao:`Você indicou "${resp('nivel')}". As cargas, o volume de séries e a complexidade dos exercícios do ${p.title} partem exatamente desse ponto — nem fácil demais, nem além do que seu corpo está pronto para executar.`});
  if(resp('foco')) ajustes.push({titulo:'Prioridade nos seus focos', descricao:`Seus grupos/temas prioritários (${resp('foco')}) recebem mais volume e aparecem no início das sessões, quando sua energia está no máximo.`});
  if(resp('tempo')||resp('disponibilidade')) ajustes.push({titulo:'Encaixado na sua rotina', descricao:`Com "${resp('tempo')||resp('disponibilidade')}", cada sessão foi dimensionada para caber no seu tempo real — consistência vale mais do que sessões heroicas de vez em quando.`});
  if(resp('trimestre')) ajustes.push({titulo:'Adaptado à sua fase da gestação', descricao:`Programa ajustado para "${resp('trimestre')}": exercícios, posições e intensidade seguem as recomendações de segurança para esta fase. Mantenha seu obstetra sempre informado.`});
  if(resp('idade')) ajustes.push({titulo:'Progressão segura para a sua faixa etária', descricao:`Na faixa "${resp('idade')}", o programa prioriza força funcional, equilíbrio e articulações protegidas, com progressão gradual semana a semana.`});
  if(resp('tipo')) ajustes.push({titulo:'Exercícios adaptados à sua condição', descricao:`Todos os movimentos foram selecionados considerando "${resp('tipo')}", com alternativas seguras e foco em autonomia e força real para o dia a dia.`});
  if(resp('obstaculo')||resp('fraqueza')||resp('problema')) ajustes.push({titulo:'Estratégia contra o seu maior desafio', descricao:`Seu principal obstáculo ("${resp('obstaculo')||resp('fraqueza')||resp('problema')}") guiou a estrutura do programa: cada semana tem um plano claro para você não travar nesse ponto de novo.`});
  if(dores.length||lesoes.length) ajustes.push({titulo:'Proteção das regiões sensíveis', descricao:`Regiões sinalizadas (${[...new Set([...dores,...lesoes])].join(', ')}) recebem exercícios substitutos e trabalho de fortalecimento preventivo — treinar sem dor é inegociável.`});
  if(restricoes.length) ajustes.push({titulo:'Respeitando suas restrições', descricao:`As orientações consideram: ${restricoes.join(', ')}. Nada no programa entra em conflito com essas condições.`});
  while(ajustes.length<3) ajustes.push({titulo:'Progressão periodizada Rennan Dias', descricao:'O programa segue blocos de adaptação, acumulação e intensificação com semanas de deload programadas — o método que gera resultado sem estagnar.'});

  const alerta = (dores.length||lesoes.length||/liberação|restrições/i.test(resp('liberacao')))
    ? `Atenção especial: ${[...new Set([...dores,...lesoes])].join(', ')||'sua condição indicada'}. Interrompa qualquer exercício que gere dor aguda e avise o Rennan pelo WhatsApp para ajustarmos na hora.${resp('liberacao')&&!/sim/i.test(resp('liberacao'))?' E lembre-se: consulte seu médico antes de iniciar.':''}`
    : null;

  return {
    saudacao:`${nome}, seja muito bem-vindo(a) ao ${p.title}! Analisei suas respostas e o programa já está moldado para a sua realidade — agora é executar.`,
    perfil:`Perfil identificado: ${resp('nivel')||resp('atividade')||resp('experiencia')||an.tempo||'em evolução'}${an.peso?`, ${an.peso}kg`:''}${an.altura?` e ${an.altura}cm`:''}. ${resp('objetivo')||(an.obj||[])[0]?`Objetivo central: ${resp('objetivo')||(an.obj||[]).join(', ')}.`:'Objetivo: evoluir com constância e segurança.'}${obsTexto?` Suas observações ("${obsTexto.slice(0,120)}${obsTexto.length>120?'...':''}") foram consideradas.`:''}`,
    ajustes:ajustes.slice(0,4),
    dica_principal:`Nas 2 primeiras semanas, seu único objetivo é não faltar. A adaptação neural vem antes do resultado visível — quem executa a semana 1 e 2 completa tem 3x mais chance de chegar na semana 12. Anote suas cargas em todos os treinos.`,
    alerta,
    semana1:`Comece com as cargas sugeridas como "confortáveis": você deve terminar cada série sentindo que ainda faria 2-3 repetições. Foque em aprender a execução perfeita de cada exercício, durma bem e hidrate-se. A partir da semana 2, começamos a progressão de verdade.`
  };
}

function showIntakeResult(plan, p, u){
  // Save personalization to user data
  const email = DB.get('fq_cur');
  const users = DB.get('fq_users')||{};
  if(users[email]){
    if(!users[email].programIntakes) users[email].programIntakes={};
    users[email].programIntakes[p.id] = {
      answers: intakeState.answers,
      plan,
      date: new Date().toISOString()
    };
    DB.set('fq_users', users);
    syncU(users[email]);
  }

  const html = plan ? `
    <div style="text-align:center;margin-bottom:20px">
      <div style="font-size:40px;margin-bottom:10px">🎉</div>
      <div style="font-size:18px;font-weight:900;margin-bottom:6px">Programa personalizado!</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6">${plan.saudacao}</div>
    </div>

    <div class="intake-result-card">
      <div style="font-size:10px;font-weight:800;color:var(--r);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">📊 Seu perfil</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6">${plan.perfil}</div>
    </div>

    <div class="intake-result-card">
      <div style="font-size:10px;font-weight:800;color:var(--r);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px">⚙️ Como o programa foi ajustado para você</div>
      ${(plan.ajustes||[]).map(a=>`
        <div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--b)">
          <div style="font-size:13px;font-weight:800;margin-bottom:4px">✅ ${a.titulo}</div>
          <div style="font-size:12px;color:var(--t2);line-height:1.6">${a.descricao}</div>
        </div>`).join('')}
    </div>

    ${plan.alerta ? `<div style="background:rgba(229,9,20,.06);border:1px solid rgba(229,9,20,.2);border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-size:11px;font-weight:800;color:var(--r);margin-bottom:6px">⚠️ ATENÇÃO ESPECIAL</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6">${plan.alerta}</div>
    </div>` : ''}

    <div class="intake-result-card">
      <div style="font-size:10px;font-weight:800;color:#f39c12;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">💡 Dica de ouro para você</div>
      <div style="font-size:13px;color:var(--t);line-height:1.6;font-style:italic">"${plan.dica_principal}"</div>
    </div>

    <div class="intake-result-card">
      <div style="font-size:10px;font-weight:800;color:#2ecc71;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px">🚀 Sua Semana 1</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.6">${plan.semana1}</div>
    </div>
  ` : `
    <div style="text-align:center;padding:20px">
      <div style="font-size:40px;margin-bottom:12px">✅</div>
      <div style="font-size:16px;font-weight:800;margin-bottom:8px">Respostas salvas!</div>
      <div style="font-size:13px;color:var(--mu)">Rennan vai revisar e personalizar seu programa em breve.</div>
    </div>`;

  document.getElementById('intake-steps-container').innerHTML = html;
  document.getElementById('intake-nav').style.display='flex';
  document.getElementById('intake-btn-back').style.display='none';

  const nextBtn = document.getElementById('intake-btn-next');
  nextBtn.textContent = '🛒 Adquirir programa agora';
  nextBtn.onclick = ()=>{ closeModal('modal-intake'); buyProgram(p.id, p.mpLink); };
}


// ── PACOTE COMPLETO DE EBOOKS (movido do <head> do index.html original) ──
async function comprarPacoteEbooks() {
  const u = getU();
  if (!u) { show('sc-splash'); return; }
  const ok = await fqConfirm('📚 Pacote Completo de E-Books', 'R$ 50,00 — acesso vitalício aos 10 e-books.\n\nVocê será redirecionado ao Mercado Pago para pagar com Pix, cartão ou boleto. Assim que o pagamento for aprovado, os e-books são liberados automaticamente.', 'Ir para o pagamento');
  if (!ok) return;
  fqCheckout('pacote_ebooks', 'https://mpago.la/26kZgpg');
}

// Chamada apenas quando o pagamento é confirmado (webhook/admin)
function liberarPacoteEbooks(u) {
  const todosEbooks = ['hypertrophy','elderly','pregnancy','disabled','fatburn','running10k','posture','stress','technique','nutrition'];
  const users = DB.get('fq_users') || {};
  u.purchases = [...new Set([...(u.purchases||[]), ...todosEbooks])];
  u.pacoteEbooks = true;
  users[u.email] = u;
  DB.set('fq_users', users);
  if (sb) syncU(u).catch(()=>{});
  fqToast('🎉 Pacote desbloqueado! Os 10 e-books estão na sua Loja!','ok');
  _safe(()=>renderStore(u),'store');
}

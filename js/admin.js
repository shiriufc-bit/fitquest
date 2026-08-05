// ═══════════════════════════════════════════════════════════
// FITQUEST — admin.js
// Painel administrativo: alunos, trocar treino, criar aluno,
// resetar senha, marcar como pago.
// ═══════════════════════════════════════════════════════════

// ══ ADMIN (dados vêm do Supabase — todos os alunos, de qualquer aparelho) ══
window.ADM_CACHE=[];
window.ADM_COMPRAS=[];
async function adminLogout(){try{if(sb)await sb.auth.signOut();}catch(e){}DB.del('fq_cur');show('sc-splash');}
// ══ ADMIN: TROCAR TREINO — regenera os exercícios da semana atual do aluno,
// mantendo a fase de periodização (séries/reps/carga), grupo muscular e restrições
// de segurança (lesão/equipamento), só varia QUAIS exercícios específicos são usados. ══

function resumoTreinoAluno(u){
  if(!u.aiPlan||!u.gymWeek)return 'Sem plano gerado ainda';
  const semana=u.aiPlan['Semana '+u.gymWeek];
  if(!semana||!semana.days)return 'Sem plano na semana atual';
  const dias=Object.keys(semana.days);
  const totalEx=Object.values(semana.days).reduce((a,exs)=>a+exs.length,0);
  return dias.join(' · ')+' ('+totalEx+' exercícios)';
}

function renderTrocarTreinos(filtro){
  const users=DB.get('fq_users')||{};
  const lista=(window.ADM_CACHE||Object.values(users)).filter(u=>!u.isAdmin);
  const termo=(filtro||'').toLowerCase();
  const filtrados=lista.filter(u=>!termo||(u.name||'').toLowerCase().includes(termo)||(u.email||'').toLowerCase().includes(termo));

  document.getElementById('treinos-list').innerHTML = filtrados.length ? filtrados.map(u=>{
    const temPlano = u.aiPlan && u.gymWeek && u.aiPlan['Semana '+u.gymWeek];
    return `<div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:800;margin-bottom:2px">${u.name||'—'}</div>
      <div style="font-size:10.5px;color:var(--mu);margin-bottom:10px">${resumoTreinoAluno(u)}</div>
      <button class="st-btn" ${temPlano?'':'disabled'} onclick="admTrocarTreino('${u.email}')"
        style="width:100%;background:${temPlano?'rgba(229,9,20,.12)':'rgba(255,255,255,.04)'};color:${temPlano?'var(--r)':'var(--mu)'};border:1px solid ${temPlano?'rgba(229,9,20,.3)':'var(--b)'}">
        🔄 Trocar Treino
      </button>
    </div>`;
  }).join('') : '<div style="text-align:center;color:var(--mu);padding:30px;font-size:12px">Nenhum aluno encontrado</div>';
}

async function admTrocarTreino(email){
  const users=DB.get('fq_users')||{};
  const u=users[email]||(window.ADM_CACHE||[]).find(a=>a.email===email);
  if(!u||!u.anamnese||!u.aiPlan||!u.gymWeek){ fqToast('Aluno sem plano ativo para trocar.','warn'); return; }

  if(!await fqConfirm('Trocar treino', 'Gerar novas variações de exercício para '+u.name+', mantendo o mesmo objetivo e fase de treino?', 'Trocar', '🔄')) return;

  try{
    const p=RD_perfil(u.anamnese,u.email);
    const semanaAtual=u.gymWeek;
    const planoAtual=u.aiPlan['Semana '+semanaAtual];
    if(!planoAtual||!planoAtual.days){ fqToast('Não encontrei o plano dessa semana.','warn'); return; }

    const novosDays={};
    Object.entries(planoAtual.days).forEach(([nomeDia,exsAtuais])=>{
      const novosExs=exsAtuais.map(exAtual=>{
        const exOriginal=EXERCISE_BANK.find(e=>e.id===exAtual.id);
        if(!exOriginal||!exOriginal.muscle) return exAtual; // sem info suficiente, mantém como está
        const grupo=exOriginal.muscle.split(/[\/\s]/)[0].toLowerCase();
        const ehComposto=/supino|agachamento|hack squat|terra|remada curvada|remada t\b|cavalinho|remada baixa|desenvolvimento|puxada|barra fixa|leg press|stiff|thruster|burpee|clean|snatch|devil press|man maker|turkish get|wall ball|sled push/i.test(exOriginal.name);
        const alternativas=RD_escolhe(grupo,1,p,semanaAtual+100,[exAtual.id],ehComposto); // +100 força offset de rotação diferente
        const novoEx=alternativas[0];
        if(!novoEx) return exAtual; // não achou alternativa segura, mantém o original
        // Mantém sets/reps/rest/carga da FASE (o objetivo), só troca o exercício e a técnica (obs)
        return {...exAtual, id:novoEx.id, obs:exAtual.obs.replace(/^[^.]*\./, novoEx.obs?(''+novoEx.obs):'Execute com controle total.')};
      });
      novosDays[nomeDia]=novosExs;
    });

    u.aiPlan['Semana '+semanaAtual]={...planoAtual, days:novosDays};
    users[email]=u; DB.set('fq_users',users);
    if(window.ADM_CACHE){const s=window.ADM_CACHE.find(a=>a.email===email);if(s)s.aiPlan=u.aiPlan;}
    if(sb) await sb.from('alunos').update({ai_plan:u.aiPlan}).eq('email',email);

    fqToast('✅ Treino trocado! '+u.name+' já vê os novos exercícios no app.','ok');
    renderTrocarTreinos(document.getElementById('treinos-search')?.value||'');
  }catch(e){
    console.error('Trocar treino erro:',e);
    fqToast('Erro ao trocar treino: '+(e?.message||'tente novamente'),'warn');
  }
}

function switchAdm(name,btn){document.querySelectorAll('.adm-panel').forEach(p=>p.classList.remove('active'));document.querySelectorAll('.adm-nav .nbtn').forEach(b=>b.classList.remove('active'));document.getElementById('adm-'+name).classList.add('active');if(btn)btn.classList.add('active');if(name==='exercises')renderBank();if(name==='treinos')renderTrocarTreinos();}
async function loadAdmin(){
  let all=[];
  if(sb){
    try{
      const{data,error}=await sb.from('alunos').select('*').order('criado_em',{ascending:false});
      if(!error&&data)all=data.map(rowToUser).filter(u=>!u.isAdmin);
      const{data:compras}=await sb.from('compras').select('*').order('criado_em',{ascending:false});
      window.ADM_COMPRAS=compras||[];
    }catch(e){console.warn('Admin load:',e);}
  }
  if(!all.length){
    const users=DB.get('fq_users')||{};
    all=Object.values(users).filter(u=>u.email!==ADMIN_EMAIL);
  }
  window.ADM_CACHE=all;
  const active=all.filter(u=>u.trainApproved);
  const pending=all.filter(u=>!u.trainApproved);
  const withEbooks=all.filter(u=>(u.purchases||[]).length>0||u.pacoteEbooks);
  const totalWorkouts=all.reduce((s,u)=>s+(u.stats?.treinos||0),0);
  // Receita real: soma das compras confirmadas no banco; se não houver, estimativa
  const receitaReal=(window.ADM_COMPRAS||[]).reduce((s,c)=>s+(parseFloat(c.valor)||0),0);
  const ebookRevenue=receitaReal>0?receitaReal:all.reduce((s,u)=>{
    const ind=(u.purchases||[]).length*14.99;
    const pack=u.pacoteEbooks?50:0;
    return s+Math.max(ind,pack);
  },0);

  // ── KPIs ──
  const kpiEl=document.getElementById('adm-kpis');
  if(kpiEl) kpiEl.innerHTML=`
    <div class="kpi-card red"><div class="kpi-icon">👥</div><div class="kpi-val">${all.length}</div><div class="kpi-lbl">Total de Alunos</div></div>
    <div class="kpi-card green"><div class="kpi-icon">✅</div><div class="kpi-val">${active.length}</div><div class="kpi-lbl">Ativos</div></div>
    <div class="kpi-card gold"><div class="kpi-icon">⏳</div><div class="kpi-val">${pending.length}</div><div class="kpi-lbl">Pendentes</div></div>
    <div class="kpi-card blue"><div class="kpi-icon">📚</div><div class="kpi-val">${withEbooks.length}</div><div class="kpi-lbl">Com E-Books</div></div>`;

  // ── Revenue ──
  const revEl=document.getElementById('adm-revenue');
  const receitaLabel=(window.ADM_COMPRAS||[]).length?'💰 Receita Confirmada (Mercado Pago)':'💰 Receita Estimada Total';
  if(revEl) revEl.innerHTML=`
    <div class="revenue-label">${receitaLabel}</div>
    <div class="revenue-val">R$ ${ebookRevenue.toFixed(2).replace('.',',')}</div>
    <div class="revenue-sub">${withEbooks.length} alunos com e-books · Média R$ ${withEbooks.length?((ebookRevenue/withEbooks.length).toFixed(2).replace('.',',')):0} por aluno</div>
    <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
      <div style="background:rgba(46,204,113,.1);border:1px solid rgba(46,204,113,.2);border-radius:6px;padding:5px 10px;font-size:10px;color:#2ecc71;font-weight:700">🏋️ ${totalWorkouts} treinos totais</div>
      <div style="background:rgba(52,152,219,.1);border:1px solid rgba(52,152,219,.2);border-radius:6px;padding:5px 10px;font-size:10px;color:#3498db;font-weight:700">📚 ${withEbooks.length} compraram e-books</div>
    </div>`;

  // ── Recent (last 5) ──
  const recent=[...all].sort((a,b)=>new Date(b.createdAt||0)-new Date(a.createdAt||0)).slice(0,5);
  const rcEl=document.getElementById('adm-recent-list');
  const rcCount=document.getElementById('adm-recent-count');
  if(rcCount) rcCount.textContent=`(${recent.length})`;
  if(rcEl) rcEl.innerHTML=recent.length?recent.map(u=>admStudentCard(u,true)).join(''):`<div class="adm-empty"><div class="adm-empty-icon">👥</div><div>Nenhum aluno ainda</div></div>`;

  // ── Coleta de dados: conversão no teste grátis ──
  renderConversao(all);

  // ── Full students list ──
  admRenderStudents(all,'all');

  // ── Leads de Consultoria ──
  admRenderLeads();
}

async function admRenderLeads(){
  let leads = [];
  if(sb){
    try{
      const{data}=await sb.from('consultoria_leads').select('*').order('criado_em',{ascending:false});
      if(data)leads=data.map(l=>({id:l.id,nome:l.nome,fone:l.telefone,obj:l.objetivo,modalidade:l.modalidade,plano:l.plano,data:l.criado_em}));
    }catch(e){}
  }
  if(!leads.length)leads = DB.get('fq_consult_leads') || [];
  window.ADM_LEADS=leads;
  const countEl = document.getElementById('adm-leads-count');
  const listEl = document.getElementById('adm-leads-list');
  if(countEl) countEl.textContent = `(${leads.length})`;
  if(!listEl) return;
  if(!leads.length){
    listEl.innerHTML = '<div style="background:#0f0f0f;border:1px solid var(--b);border-radius:12px;padding:20px;text-align:center;color:var(--mu);font-size:12px">Nenhum lead de consultoria ainda</div>';
    return;
  }
  listEl.innerHTML = leads.map((l,i)=>{
    const modalIcon = l.modalidade==='musculacao'?'🏋️':'🏃';
    const dataF = l.data?new Date(l.data).toLocaleDateString('pt-BR'):'';
    const msg = `Ol%C3%A1%20${encodeURIComponent(l.nome)}!%20Sou%20o%20Rennan,%20recebi%20seu%20interesse%20na%20consultoria%20de%20${l.modalidade==='musculacao'?'Muscula%C3%A7%C3%A3o':'Corrida'}.`;
    const foneClean = (l.fone||'').replace(/\D/g,'');
    const waFone = foneClean.length>=10 ? (foneClean.startsWith('55')?foneClean:'55'+foneClean) : '5531995250330';
    return `<div style="background:#0f0f0f;border:1px solid rgba(243,156,18,.2);border-radius:12px;padding:14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:800">${modalIcon} ${l.nome}</div>
          <div style="font-size:11px;color:var(--t2);margin-top:2px">${l.fone} · Plano ${l.plano}</div>
        </div>
        <div style="font-size:9px;color:var(--mu)">${dataF}</div>
      </div>
      ${l.obj?`<div style="font-size:11px;color:var(--t2);background:rgba(255,255,255,.03);border-radius:8px;padding:8px;margin-bottom:8px">🎯 ${l.obj}</div>`:''}
      <div style="display:flex;gap:6px">
        <a href="https://wa.me/${waFone}?text=${msg}" target="_blank" style="flex:1;text-align:center;background:rgba(37,211,102,.12);border:1px solid rgba(37,211,102,.3);border-radius:8px;padding:8px;color:#25D366;font-size:11px;font-weight:800;text-decoration:none">💬 Responder</a>
        <button onclick="admDelLead(${i})" style="background:rgba(255,255,255,.05);border:1px solid var(--b);border-radius:8px;padding:8px 12px;color:var(--mu);font-size:11px;font-weight:700;cursor:pointer">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function admDelLead(idx){
  const leads = window.ADM_LEADS||[];
  const lead = leads[idx];
  if(!lead)return;
  if(!await fqConfirm('Excluir lead','Remover este lead da lista?','Excluir','🗑️'))return;
  if(lead.id&&sb){try{await sb.from('consultoria_leads').delete().eq('id',lead.id);}catch(e){}}
  else{const local=DB.get('fq_consult_leads')||[];local.splice(idx,1);DB.set('fq_consult_leads',local);}
  admRenderLeads();
}


function admAlertaSaude(an){
  if(!an) return '';
  const condicoes=(an.saude||[]).filter(s=>s&&!/nenhuma/i.test(s));
  const temMed=an.med==='Sim';
  const temCir=an.cir&&an.cir.trim().length>0;
  if(!condicoes.length&&!temMed&&!temCir) return '';
  const itens=[];
  if(condicoes.length) itens.push(`<div>🩺 <strong>Condições:</strong> ${condicoes.join(', ')}</div>`);
  if(temMed) itens.push(`<div>💊 <strong>Medicamentos:</strong> ${an.medDesc||'não especificado'}</div>`);
  if(temCir) itens.push(`<div>🔪 <strong>Cirurgias:</strong> ${an.cir}</div>`);
  return `<div style="margin:0 14px 10px;padding:10px 12px;background:rgba(243,156,18,.1);border:1px solid rgba(243,156,18,.35);border-radius:8px">
    <div style="font-size:10px;font-weight:800;color:#f39c12;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px">⚠️ Atenção — dados de saúde do aluno</div>
    <div style="font-size:11px;color:#e8b566;line-height:1.6">${itens.join('')}</div>
  </div>`;
}

// ══ ADMIN: CRIAR ALUNO MANUALMENTE ══
function openCriarAluno(){
  document.getElementById('ca-nome').value='';
  document.getElementById('ca-email').value='';
  document.getElementById('ca-senha').value='';
  abrirModal('modal-criar-aluno');
}

async function admCriarAluno(){
  const nome = sanitizeStr(document.getElementById('ca-nome').value, 80);
  const email = document.getElementById('ca-email').value.trim().toLowerCase();
  const senha = document.getElementById('ca-senha').value;
  if(!nome||!email||!senha){ fqToast('Preencha nome, e-mail e senha.','warn'); return; }
  if(senha.length<6){ fqToast('Senha mínimo 6 caracteres.','warn'); return; }
  const valEmailAdm=validarEmail(email);
  if(!valEmailAdm.ok){ fqToast(valEmailAdm.msg.replace(/<[^>]*>/g,''),'warn'); return; }
  if(!sb){ fqToast('Sem conexão com o servidor.','warn'); return; }

  const btn=document.getElementById('btn-criar-aluno'); btn.disabled=true; btn.textContent='Criando...';
  try{
    const{data,error}=await sb.auth.signUp({email,password:senha,options:{data:{nome}}});
    if(error){
      fqToast(/already|registered/i.test(error.message)?'Este e-mail já está cadastrado.':'Erro: '+error.message,'warn');
      return;
    }
    const u = novoPerfilLocal(data.user.id, nome, email);
    await sb.from('alunos').upsert(userToRow(u), {onConflict:'id'});

    // Proteção: signUp NUNCA deve trocar a sessão ativa do admin.
    // Se por algum motivo isso acontecer (confirmação de e-mail desativada no projeto),
    // desloga a sessão nova e avisa o admin a logar de novo — evita ficar "preso" como o aluno novo.
    if(data.session){
      await sb.auth.signOut();
      fqToast('Aluno criado! Por segurança, faça login novamente no admin.','ok');
      closeModal('modal-criar-aluno');
      DB.del('fq_cur');
      show('sc-splash');
      return;
    }

    const users=DB.get('fq_users')||{}; users[email]=u; DB.set('fq_users',users);
    fqToast('✅ Aluno criado! Ele recebeu um e-mail de confirmação — avise que a senha inicial é a que você definiu.','ok');
    closeModal('modal-criar-aluno');
    await loadAdmin();
  }catch(e){
    console.error('Criar aluno:',e);
    fqToast('Erro ao criar aluno: '+(e?.message||'tente novamente'),'warn');
  }finally{
    btn.disabled=false; btn.textContent='Criar aluno';
  }
}

// ══ ADMIN: RESET DE SENHA (nunca vemos a senha — só disparamos o link) ══
// ══ ADMIN: MARCAR ALUNO COMO PAGO — libera acesso manualmente após confirmar
// o pagamento no Mercado Pago (os dois planos são pagamento único, sem webhook). ══
let _pagoEmailAtual = null;

function abrirMarcarPago(email){
  _pagoEmailAtual = email;
  abrirModal('modal-marcar-pago');
}

async function admConfirmarPago(planoId){
  const email = _pagoEmailAtual;
  if(!email){ fqToast('Erro: aluno não identificado.','warn'); return; }
  const dias = planoId==='anual' ? 365 : 30;
  const nomePlano = planoId==='anual' ? 'Anual' : 'Mensal';
  if(!await fqConfirm('Confirmar pagamento', `Confirma que ${email} pagou o plano ${nomePlano}? Isso libera o acesso por ${dias} dias.`, 'Confirmar', '💳')) return;

  try{
    const users = DB.get('fq_users')||{};
    const u = users[email] || (window.ADM_CACHE||[]).find(a=>a.email===email);
    if(!u){ fqToast('Aluno não encontrado.','warn'); return; }

    const agora = new Date();
    const ate = new Date(agora.getTime() + dias*24*60*60*1000);
    u.assinaturaStatus = 'ativa';
    u.assinaturaAte = ate.toISOString();
    u.plano = planoId;

    // ── COLETA DE DADOS: em que dia do teste o aluno decidiu assinar ──
    // Só grava na PRIMEIRA conversão — renovações não sobrescrevem o dado original,
    // senão perderíamos a informação de quando ele decidiu pela primeira vez.
    const jaConvertido = u.diaConversao !== undefined && u.diaConversao !== null;
    if(!jaConvertido){
      u.dataConversao = agora.toISOString();
      u.planoConversao = planoId;
      // TRAVA O PREÇO: quem entrou na campanha paga esse valor pra sempre,
      // mesmo depois que a promo acabar. Guardamos o preço e o número da vaga
      // pra você ter o registro de quem entrou como fundador.
      if(promoAtiva()){
        u.precoTravado = (PLANOS_PROMO[planoId]||{}).preco || null;
        u.promoFundador = true;
        u.promoVaga = PROMO_VAGAS_USADAS + 1;
      }else{
        u.precoTravado = (PLANOS_NORMAL[planoId]||{}).preco || null;
        u.promoFundador = false;
      }
      if(u.trialInicio){
        const diasDesdeInicio = Math.floor((agora - new Date(u.trialInicio))/(1000*60*60*24));
        u.diaConversao = Math.max(0, diasDesdeInicio);
      }
    }

    users[email] = u;
    DB.set('fq_users', users);
    if(window.ADM_CACHE){ const s=window.ADM_CACHE.find(a=>a.email===email); if(s){ s.assinaturaStatus='ativa'; s.assinaturaAte=u.assinaturaAte; s.plano=planoId; s.diaConversao=u.diaConversao; s.dataConversao=u.dataConversao; s.planoConversao=u.planoConversao; } }
    if(sb) await sb.from('alunos').update({
      assinatura_status:'ativa', assinatura_ate:u.assinaturaAte, plano:planoId,
      dia_conversao:u.diaConversao ?? null, data_conversao:u.dataConversao ?? null, plano_conversao:u.planoConversao ?? null,
      preco_travado:u.precoTravado ?? null, promo_fundador:u.promoFundador ?? false, promo_vaga:u.promoVaga ?? null
    }).eq('email',email);

    closeModal('modal-marcar-pago');
    fqToast(`✅ Acesso liberado até ${ate.toLocaleDateString('pt-BR')}`,'ok');
    if(typeof loadAdmin==='function') loadAdmin().then(()=>{ if(typeof admRenderStudents==='function' && window.ADM_CACHE) admRenderStudents(window.ADM_CACHE); });
  }catch(e){
    console.error('Marcar pago erro:', e);
    fqToast('Erro ao liberar acesso: '+(e?.message||'tente novamente'),'warn');
  }
}

async function admResetSenha(email){
  if(!sb){ fqToast('Sem conexão com o servidor.','warn'); return; }
  if(!await fqConfirm('Redefinir senha', `Enviar link de redefinição de senha para ${email}?`, 'Enviar', '🔑')) return;
  try{
    const{error}=await sb.auth.resetPasswordForEmail(email);
    if(error){ fqToast('Erro: '+error.message,'warn'); return; }
    fqToast('📧 Link de redefinição enviado para '+email,'ok');
  }catch(e){
    fqToast('Erro ao enviar redefinição.','warn');
  }
}

const FQ_JORNADAS={"trilhas":{"ini_casa":[{"n":1,"nome":"Primeiro Contato","dur":12,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento — solte o corpo sem pressa"},{"ex":["e056"],"sets":2,"reps":"8","rest":60,"nota":"Mãos apoiadas em banco ou parede. Desça controlado"},{"ex":["e019"],"sets":2,"reps":"10","rest":60,"nota":"Peso nos calcanhares, joelhos alinhados aos pés"},{"ex":["e029"],"sets":2,"reps":"20s","rest":45,"nota":"Corpo em linha reta. Contraia o abdômen"}]},{"n":2,"nome":"Encontrando o Ritmo","dur":13,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e056"],"sets":3,"reps":"8","rest":60,"nota":"3 séries hoje — você está evoluindo"},{"ex":["e019"],"sets":3,"reps":"12","rest":60,"nota":"Desça até onde conseguir com boa forma"},{"ex":["e040"],"sets":2,"reps":"8 cada","rest":45,"nota":"Lombar sempre colada no chão"}]},{"n":3,"nome":"Base Firme","dur":14,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e130"],"sets":3,"reps":"12 cada","rest":60,"nota":"Aperte o glúteo 1s no topo"},{"ex":["e055"],"sets":2,"reps":"6","rest":60,"nota":"Primeira flexão no chão! Vá até onde der"},{"ex":["e029"],"sets":3,"reps":"25s","rest":45,"nota":"Sem deixar o quadril cair"}]},{"n":4,"nome":"Corpo Inteiro","dur":15,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e019"],"sets":3,"reps":"15","rest":55,"nota":"Ritmo constante"},{"ex":["e056"],"sets":3,"reps":"10","rest":55,"nota":"Controle na descida"},{"ex":["e007"],"sets":3,"reps":"10 cada","rest":55,"nota":"Use uma garrafa d'água ou mochila se não tiver halter"},{"ex":["e136"],"sets":2,"reps":"8 cada","rest":45,"nota":"Segure 2s em cima"}]},{"n":5,"nome":"Resistência","dur":15,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e019"],"sets":3,"reps":"15","rest":55,"nota":"Sem parar no meio da série"},{"ex":["e055"],"sets":3,"reps":"8","rest":55,"nota":"Se cansar, apoie os joelhos"},{"ex":["e029"],"sets":3,"reps":"30s","rest":45,"nota":"Respire normalmente durante a prancha"}]},{"n":6,"nome":"Primeiro Circuito","dur":16,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento caprichado — hoje o ritmo sobe"},{"ex":["e019","e056","e029"],"sets":3,"reps":"12 / 10 / 25s","rest":60,"nota":"Faça os 3 seguidos, descanse só no fim da rodada"}]},{"n":7,"nome":"Unilateral","dur":16,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e127","e130","e039"],"sets":3,"reps":"8 cada / 12 cada / 20s cada","rest":55,"nota":"Um lado de cada vez — corrige desequilíbrios"}]},{"n":8,"nome":"Ritmo Acelerado","dur":17,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e019","e055","e096","e029"],"sets":3,"reps":"15 / 8 / 20s / 30s","rest":50,"nota":"Descanso encurtou pra 50s — segure o ritmo"}]},{"n":9,"nome":"Desafio Crescente","dur":18,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e019","e055","e007","e096"],"sets":4,"reps":"15 / 10 / 12 cada / 25s","rest":45,"nota":"4 rodadas! Você já consegue muito mais que na missão 1"}]},{"n":10,"nome":"Formatura Iniciante","dur":18,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e019","e055","e130","e029","e096"],"sets":4,"reps":"18 / 12 / 15 cada / 35s / 30s","rest":45,"nota":"🎓 Última missão! Compare com a missão 1 — a evolução é sua"}]}],"ini_academia":[{"n":1,"nome":"Conhecendo as Máquinas","dur":12,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento na esteira ou bike"},{"ex":["e187"],"sets":2,"reps":"12","rest":60,"nota":"Supino na máquina — trajetória guiada, ideal pra começar"},{"ex":["e020"],"sets":2,"reps":"12","rest":60,"nota":"Não trave os joelhos no topo"},{"ex":["e029"],"sets":2,"reps":"20s","rest":45,"nota":"Corpo em linha reta"}]},{"n":2,"nome":"Puxar e Empurrar","dur":13,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e187"],"sets":3,"reps":"12","rest":60,"nota":"3 séries hoje"},{"ex":["e217"],"sets":3,"reps":"12","rest":60,"nota":"Remada na máquina — aperte as escápulas"},{"ex":["e023"],"sets":2,"reps":"15","rest":45,"nota":"Segure 1s no topo"}]},{"n":3,"nome":"Pernas na Máquina","dur":14,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e020"],"sets":3,"reps":"15","rest":60,"nota":"Amplitude confortável"},{"ex":["e023"],"sets":3,"reps":"15","rest":55,"nota":"Movimento controlado"},{"ex":["e083"],"sets":3,"reps":"12","rest":55,"nota":"Posterior de coxa"}]},{"n":4,"nome":"Corpo Completo","dur":15,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e187"],"sets":3,"reps":"12","rest":55,"nota":"Escápulas retraídas"},{"ex":["e006"],"sets":3,"reps":"12","rest":55,"nota":"Puxada alta — leve à altura do queixo"},{"ex":["e020"],"sets":3,"reps":"15","rest":55,"nota":"Pés na largura dos ombros"},{"ex":["e029"],"sets":2,"reps":"25s","rest":45,"nota":"Core firme"}]},{"n":5,"nome":"Volume Crescente","dur":15,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"4 min","rest":0,"nota":"Aquecimento"},{"ex":["e001"],"sets":3,"reps":"10","rest":60,"nota":"Primeiro supino com barra! Peça ajuda se precisar"},{"ex":["e030"],"sets":3,"reps":"12","rest":55,"nota":"Puxe até o abdômen"},{"ex":["e025"],"sets":3,"reps":"15","rest":45,"nota":"Amplitude total"}]},{"n":6,"nome":"Primeiro Circuito","dur":16,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e020","e187","e029"],"sets":3,"reps":"15 / 12 / 25s","rest":60,"nota":"Sem parar entre exercícios"}]},{"n":7,"nome":"Ombro e Braço","dur":16,"formato":"Direto","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e010"],"sets":3,"reps":"12","rest":55,"nota":"Não arqueie a lombar"},{"ex":["e011"],"sets":3,"reps":"15","rest":50,"nota":"Cotovelo levemente flexionado"},{"ex":["e013"],"sets":3,"reps":"12","rest":50,"nota":"Cotovelos fixos ao lado do corpo"},{"ex":["e016"],"sets":3,"reps":"15","rest":45,"nota":"Cotovelos colados"}]},{"n":8,"nome":"Densidade","dur":17,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e020","e006","e010","e029"],"sets":3,"reps":"15 / 12 / 12 / 30s","rest":50,"nota":"Descanso caiu — mantenha a forma"}]},{"n":9,"nome":"Desafio Crescente","dur":18,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e001","e030","e020","e096"],"sets":4,"reps":"12 / 12 / 15 / 25s","rest":45,"nota":"4 rodadas hoje!"}]},{"n":10,"nome":"Formatura Iniciante","dur":18,"formato":"Circuito","xp":50,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e001","e006","e020","e025","e029"],"sets":4,"reps":"12 / 12 / 18 / 18 / 35s","rest":45,"nota":"🎓 Última missão! Você domina a academia agora"}]}],"int_casa":[{"n":1,"nome":"Retomada Forte","dur":20,"formato":"Circuito","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento dinâmico"},{"ex":["e055","e019","e029"],"sets":4,"reps":"15 / 20 / 40s","rest":45,"nota":"RIR 2-3: pare com 2-3 reps sobrando"}]},{"n":2,"nome":"Superset","dur":22,"formato":"Superset","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e055","e007"],"sets":4,"reps":"15 / 12 cada","rest":45,"nota":"SUPERSET: os 2 seguidos, sem pausa entre eles"},{"ex":["e079","e130"],"sets":4,"reps":"10 cada / 15 cada","rest":45,"nota":"SUPERSET pernas"}]},{"n":3,"nome":"EMOM 12","dur":22,"formato":"EMOM","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e055","e019"],"sets":12,"reps":"min ímpar: 12 flexões · min par: 18 agachamentos","rest":0,"nota":"⏱️ EMOM: a cada minuto faz as reps. O que sobrar é seu descanso"}]},{"n":4,"nome":"Explosão","dur":23,"formato":"Circuito","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e117","e055","e096"],"sets":4,"reps":"15 / 15 / 40s","rest":40,"nota":"Salto com aterrissagem suave, joelho alinhado"},{"ex":["e029"],"sets":3,"reps":"45s","rest":30,"nota":"Finalizador de core"}]},{"n":5,"nome":"Unilateral Pesado","dur":24,"formato":"Superset","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e079","e084"],"sets":4,"reps":"12 cada / 12 cada","rest":45,"nota":"SUPERSET: búlgaro + stiff unilateral"},{"ex":["e184","e007"],"sets":4,"reps":"12 / 12 cada","rest":40,"nota":"SUPERSET: flexão diamante + remada"}]},{"n":6,"nome":"Escada","dur":24,"formato":"Escada","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e097","e055","e019"],"sets":1,"reps":"Escada 10-9-8-7-6-5-4-3-2-1 de cada","rest":0,"nota":"⏱️ Faz 10 de cada, depois 9 de cada... até 1. Sem descanso programado"}]},{"n":7,"nome":"AMRAP 15","dur":25,"formato":"AMRAP","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e097","e117","e096","e029"],"sets":1,"reps":"15 min — máximo de rodadas: 8 burpees, 12 saltos, 30s mountain, 30s prancha","rest":0,"nota":"⏱️ AMRAP: quantas rodadas em 15 min? Anote e tente bater na próxima"}]},{"n":8,"nome":"Densidade Máxima","dur":26,"formato":"Circuito","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e055","e079","e007","e117","e029"],"sets":4,"reps":"18 / 12 cada / 15 cada / 15 / 45s","rest":35,"nota":"Descanso caiu pra 35s — resistência real"}]},{"n":9,"nome":"Complex Corporal","dur":27,"formato":"Complex","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e019","e055","e097","e117"],"sets":5,"reps":"10 de cada, em sequência sem pausa","rest":60,"nota":"COMPLEX: 5 rodadas. Só descansa no fim de cada rodada"}]},{"n":10,"nome":"Formatura Intermediário","dur":28,"formato":"AMRAP","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento completo"},{"ex":["e097","e124","e184","e121","e029"],"sets":1,"reps":"18 min — rodadas de: 10 burpees, 10 búlgaro c/ salto cada, 12 diamante, 30s bear crawl, 45s prancha","rest":0,"nota":"🎓 Formatura! Se completou isso, você está pronto pro Avançado"}]}],"int_academia":[{"n":1,"nome":"Base de Força","dur":20,"formato":"Direto","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e001"],"sets":4,"reps":"10","rest":45,"nota":"RIR 2-3. Escápulas retraídas"},{"ex":["e005"],"sets":4,"reps":"12","rest":45,"nota":"Tronco a 45°, puxe até o abdômen"},{"ex":["e019"],"sets":4,"reps":"12","rest":45,"nota":"Agachamento livre com barra"}]},{"n":2,"nome":"Superset Peito/Costas","dur":22,"formato":"Superset","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e001","e006"],"sets":4,"reps":"10 / 12","rest":45,"nota":"SUPERSET: empurra e puxa, sem pausa entre eles"},{"ex":["e002","e030"],"sets":3,"reps":"12 / 12","rest":45,"nota":"SUPERSET inclinado + remada baixa"}]},{"n":3,"nome":"Pernas Sérias","dur":23,"formato":"Direto","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e019"],"sets":4,"reps":"10","rest":50,"nota":"Desça até paralelo"},{"ex":["e021"],"sets":4,"reps":"12","rest":45,"nota":"Quadril pra trás, lombar neutra"},{"ex":["e201"],"sets":4,"reps":"12","rest":45,"nota":"Aperte o glúteo no topo"},{"ex":["e025"],"sets":3,"reps":"18","rest":35,"nota":"Amplitude completa"}]},{"n":4,"nome":"EMOM Barra","dur":23,"formato":"EMOM","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e110","e098"],"sets":12,"reps":"min ímpar: 8 thrusters · min par: 15 kettlebell swings","rest":0,"nota":"⏱️ EMOM 12 min. Carga moderada — a fadiga acumula"}]},{"n":5,"nome":"Ombro e Braço","dur":24,"formato":"Superset","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e194","e011"],"sets":4,"reps":"12 / 15","rest":40,"nota":"SUPERSET: Arnold + elevação lateral"},{"ex":["e013","e016"],"sets":4,"reps":"12 / 15","rest":40,"nota":"SUPERSET: bíceps + tríceps"}]},{"n":6,"nome":"Circuito Metabólico","dur":25,"formato":"Circuito","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e110","e098","e116","e096"],"sets":4,"reps":"10 / 15 / 12 / 40s","rest":40,"nota":"Ritmo alto — este é o queimador"}]},{"n":7,"nome":"AMRAP 15","dur":25,"formato":"AMRAP","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e098","e116","e057","e096"],"sets":1,"reps":"15 min — rodadas de: 15 KB swing, 10 box jump, 5 barra fixa, 30s mountain","rest":0,"nota":"⏱️ AMRAP: anote suas rodadas e tente bater depois"}]},{"n":8,"nome":"Força e Densidade","dur":26,"formato":"Circuito","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"5 min","rest":0,"nota":"Aquecimento"},{"ex":["e001","e005","e019","e029"],"sets":4,"reps":"10 / 12 / 12 / 45s","rest":35,"nota":"Descanso 35s com carga real — teste de resistência"}]},{"n":9,"nome":"Complex com Barra","dur":27,"formato":"Complex","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e100","e005","e110"],"sets":5,"reps":"6 terra + 6 remada + 6 thruster, sem soltar a barra","rest":75,"nota":"COMPLEX: use carga leve/moderada. A barra não toca o chão até o fim"}]},{"n":10,"nome":"Formatura Intermediário","dur":28,"formato":"AMRAP","xp":80,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento completo"},{"ex":["e228","e098","e232","e111"],"sets":1,"reps":"18 min — rodadas de: 8 devil press, 20 KB swing, 6 burpee pull-up, 15 wall ball","rest":0,"nota":"🎓 Formatura! Isso é nível competitivo de base"}]}],"ava_casa":[{"n":1,"nome":"Teste de Fogo","dur":25,"formato":"Circuito","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento completo — hoje o corpo vai trabalhar de verdade"},{"ex":["e055","e125","e121","e029"],"sets":5,"reps":"20 / 5 cada / 40s / 60s","rest":30,"nota":"RIR 0-1: vá até quase não conseguir mais"}]},{"n":2,"nome":"Pliometria Pura","dur":26,"formato":"Circuito","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento com mobilidade de tornozelo e quadril"},{"ex":["e117","e124","e118","e120"],"sets":5,"reps":"20 / 10 cada / 10 / 12","rest":35,"nota":"Explosão máxima, aterrissagem sempre suave"}]},{"n":3,"nome":"EMOM 20","dur":26,"formato":"EMOM","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e097","e125","e184"],"sets":20,"reps":"min 1: 12 burpees · min 2: 8 pistol cada · min 3: 15 diamante · repete","rest":0,"nota":"⏱️ EMOM 20 min. Se não terminar dentro do minuto, o descanso some"}]},{"n":4,"nome":"Tabata Duplo","dur":25,"formato":"Tabata","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e117"],"sets":8,"reps":"20s máximo de saltos / 10s descanso","rest":0,"nota":"⏱️ TABATA 1: 4 min brutais. Máximo de reps em cada 20s"},{"ex":["e055"],"sets":8,"reps":"20s máximo de flexões / 10s descanso","rest":180,"nota":"⏱️ TABATA 2 após 3 min de pausa"}]},{"n":5,"nome":"Unilateral Extremo","dur":28,"formato":"Superset","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e125","e131"],"sets":5,"reps":"6 cada / 8","rest":40,"nota":"SUPERSET: pistol + nordic curl. Os dois mais difíceis do peso corporal"},{"ex":["e185","e171"],"sets":4,"reps":"6 cada / 40s cada","rest":30,"nota":"SUPERSET: archer + farmer walk unilateral"}]},{"n":6,"nome":"Escada Descendente","dur":28,"formato":"Escada","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e097","e117","e055"],"sets":1,"reps":"Escada 15-12-9-6-3 de cada, sem descanso","rest":0,"nota":"⏱️ Cronometre. Este tempo é seu recorde a bater"}]},{"n":7,"nome":"AMRAP 20","dur":30,"formato":"AMRAP","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e097","e124","e121","e185","e029"],"sets":1,"reps":"20 min — rodadas: 12 burpees, 10 búlgaro salto cada, 40s bear crawl, 8 archer cada, 60s prancha","rest":0,"nota":"⏱️ AMRAP 20. Ritmo sustentável — não estoure nas 2 primeiras rodadas"}]},{"n":8,"nome":"Complex Sem Pausa","dur":30,"formato":"Complex","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e055","e097","e117","e125","e121"],"sets":6,"reps":"8 de cada em sequência, sem parar","rest":60,"nota":"COMPLEX 6 rodadas. Cada rodada é um ciclo completo do corpo"}]},{"n":9,"nome":"Prova de Resistência","dur":32,"formato":"Circuito","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e125","e120","e131","e123","e137"],"sets":5,"reps":"8 cada / 15 / 10 / 15 / 50s","rest":25,"nota":"Descanso 25s — quase nenhum. Penúltima missão!"}]},{"n":10,"nome":"Missão Final","dur":35,"formato":"AMRAP","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"7 min","rest":0,"nota":"Aquecimento completo e caprichado"},{"ex":["e097","e125","e120","e124","e121","e029"],"sets":1,"reps":"25 min — rodadas: 15 burpees, 8 pistol cada, 15 flexão plio, 10 búlgaro salto cada, 45s bear crawl, 60s prancha","rest":0,"nota":"🏆 MISSÃO FINAL. 25 minutos. Você construiu isso do zero. Vai!"}]}],"ava_academia":[{"n":1,"nome":"Força Bruta","dur":25,"formato":"Direto","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento com séries progressivas"},{"ex":["e001"],"sets":5,"reps":"6","rest":90,"nota":"RIR 0-1. Carga alta, use segurança"},{"ex":["e100"],"sets":5,"reps":"5","rest":90,"nota":"Terra pesado. Lombar neutra SEMPRE"},{"ex":["e019"],"sets":4,"reps":"8","rest":75,"nota":"Agachamento profundo"}]},{"n":2,"nome":"Complex Olímpico","dur":26,"formato":"Complex","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento com barra vazia"},{"ex":["e100","e005","e108","e110"],"sets":5,"reps":"6 terra + 6 remada + 6 clean + 6 thruster","rest":90,"nota":"COMPLEX: a barra não toca o chão durante a rodada"}]},{"n":3,"nome":"EMOM 20","dur":27,"formato":"EMOM","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e110","e098","e232"],"sets":20,"reps":"min 1: 10 thrusters · min 2: 20 KB swing · min 3: 8 burpee pull-up · repete","rest":0,"nota":"⏱️ EMOM 20. A fadiga vai acumular — segure a técnica"}]},{"n":4,"nome":"Drop-set Peito","dur":27,"formato":"Drop-set","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e001"],"sets":4,"reps":"8 + drop 30% + máximo","rest":90,"nota":"DROP-SET: falha, tira 30% da carga, vai até a falha de novo"},{"ex":["e053"],"sets":4,"reps":"12 + drop + máximo","rest":60,"nota":"Crossover com drop-set"},{"ex":["e184"],"sets":3,"reps":"máximo","rest":45,"nota":"Finalizador até a falha"}]},{"n":5,"nome":"Costas Completo","dur":28,"formato":"Superset","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e057","e005"],"sets":5,"reps":"máximo / 10","rest":60,"nota":"SUPERSET: barra fixa até a falha + remada pesada"},{"ex":["e049","e218"],"sets":4,"reps":"12 / 15","rest":45,"nota":"SUPERSET: cavalinho + pulldown braço reto"}]},{"n":6,"nome":"Metabólico Brutal","dur":30,"formato":"Circuito","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e229","e231","e098","e234"],"sets":5,"reps":"8 / 12 / 20 / 30s","rest":30,"nota":"Man maker é o exercício mais completo que existe. Prepare-se"}]},{"n":7,"nome":"AMRAP 20","dur":30,"formato":"AMRAP","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e228","e111","e232","e098"],"sets":1,"reps":"20 min — rodadas: 10 devil press, 15 wall ball, 8 burpee pull-up, 25 KB swing","rest":0,"nota":"⏱️ AMRAP 20 estilo competição"}]},{"n":8,"nome":"Cluster Set","dur":30,"formato":"Cluster","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e019"],"sets":5,"reps":"3+3+3 (15s entre mini-séries)","rest":120,"nota":"CLUSTER: 3 reps, 15s pausa, 3 reps, 15s, 3 reps = 1 série. Permite carga altíssima"},{"ex":["e001"],"sets":4,"reps":"3+3+3 (15s entre)","rest":120,"nota":"Mesmo protocolo no supino"}]},{"n":9,"nome":"Prova de Resistência","dur":32,"formato":"Circuito","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"6 min","rest":0,"nota":"Aquecimento"},{"ex":["e110","e232","e231","e229","e096"],"sets":5,"reps":"10 / 8 / 15 / 6 / 45s","rest":25,"nota":"Descanso 25s. Penúltima — mostre do que é capaz"}]},{"n":10,"nome":"Missão Final","dur":35,"formato":"AMRAP","xp":120,"blocos":[{"ex":["e144"],"sets":1,"reps":"7 min","rest":0,"nota":"Aquecimento completo"},{"ex":["e229","e232","e228","e111","e098","e234"],"sets":1,"reps":"25 min — rodadas: 6 man maker, 8 burpee pull-up, 10 devil press, 20 wall ball, 25 KB swing, 30s battle rope","rest":0,"nota":"🏆 MISSÃO FINAL. 25 min do treino mais completo do app. Você chegou aqui!"}]}]},"meta":{"ini_casa":{"nivel":"iniciante","ambiente":"casa","nome":"Primeiros Passos","emoji":"🌱","cor":"#2ecc71","desc":"Em casa · aprenda os movimentos","xp":50},"ini_academia":{"nivel":"iniciante","ambiente":"academia","nome":"Primeiros Passos","emoji":"🌱","cor":"#2ecc71","desc":"Na academia · aprenda as máquinas","xp":50},"int_casa":{"nivel":"intermediario","ambiente":"casa","nome":"Construção","emoji":"⚡","cor":"#f39c12","desc":"Em casa · intensidade real","xp":80},"int_academia":{"nivel":"intermediario","ambiente":"academia","nome":"Construção","emoji":"⚡","cor":"#f39c12","desc":"Na academia · carga e volume","xp":80},"ava_casa":{"nivel":"avancado","ambiente":"casa","nome":"Superação","emoji":"🔥","cor":"#e50914","desc":"Em casa · sem desculpas","xp":120},"ava_academia":{"nivel":"avancado","ambiente":"academia","nome":"Superação","emoji":"🔥","cor":"#e50914","desc":"Na academia · nível competitivo","xp":120}}};

// ══════════════════════════════════════════════════════════
// FITQUEST JORNADAS — 6 trilhas (3 níveis × 2 ambientes), 10 missões cada.
// 3 missões liberadas por semana. O app sugere a trilha pela anamnese,
// mas o aluno escolhe livremente e pode trocar sem perder progresso.
// ══════════════════════════════════════════════════════════

const MISSOES_POR_SEMANA = 3;

// Sugere a trilha com base no nível da anamnese e no local de treino
function trilhaSugerida(u){
  const an = u.anamnese || {};
  const t = (an.tempo||'').toLowerCase();
  let nivel = 'iniciante';
  if(t.includes('avan')) nivel = 'avancado';
  else if(t.includes('intermedi')) nivel = 'intermediario';
  const local = (an.local||'').toLowerCase();
  const ambiente = /academia/.test(local) ? 'academia' : 'casa';
  const prefixo = nivel==='avancado'?'ava':(nivel==='intermediario'?'int':'ini');
  return prefixo + '_' + ambiente;
}

function trilhaAtual(u){ return u.jornadaTrilha || null; }
function missoesDaTrilha(chave){ return (FQ_JORNADAS.trilhas[chave]) || []; }
function metaTrilha(chave){ return FQ_JORNADAS.meta[chave] || null; }

function missoesLiberadas(u){
  if(!u.jornadaInicio) return 0;
  const inicio = new Date(u.jornadaInicio);
  const semanas = Math.floor((new Date() - inicio)/(1000*60*60*24*7));
  return Math.min(10, (semanas+1)*MISSOES_POR_SEMANA);
}

function missoesConcluidas(u){
  const t = trilhaAtual(u);
  if(!t) return 0;
  return ((u.jornadaFeitas||{})[t]||[]).length;
}

function proximaMissao(u){
  const t = trilhaAtual(u);
  if(!t) return null;
  const feitas = new Set((u.jornadaFeitas||{})[t]||[]);
  const lib = missoesLiberadas(u);
  for(let i=1;i<=lib;i++){ if(!feitas.has(i)) return i; }
  return null;
}

function diasParaProximaLiberacao(u){
  if(!u.jornadaInicio) return null;
  const dias = Math.floor((new Date() - new Date(u.jornadaInicio))/(1000*60*60*24));
  return 7 - (dias % 7);
}

function escolherTrilha(chave){
  const u = getU(); if(!u) return;
  u.jornadaTrilha = chave;
  if(!u.jornadaInicio) u.jornadaInicio = new Date().toISOString();
  u.jornadaFeitas = u.jornadaFeitas || {};
  if(!u.jornadaFeitas[chave]) u.jornadaFeitas[chave] = [];
  saveU(u);
  closeModal('modal-escolher-trilha');
  const meta = metaTrilha(chave);
  fqToast(`${meta.emoji} Jornada ${meta.nome} iniciada!`,'ok');
  renderMissoes();
}

function abrirEscolhaTrilha(){
  const u = getU(); if(!u) return;
  const sug = trilhaSugerida(u);
  const atual = trilhaAtual(u);
  const grupos = {iniciante:[],intermediario:[],avancado:[]};
  Object.entries(FQ_JORNADAS.meta).forEach(([chave,m])=>grupos[m.nivel].push([chave,m]));

  document.getElementById('trilha-lista').innerHTML = Object.entries(grupos).map(([nivel,lista])=>{
    return lista.map(([chave,m])=>{
      const ehSug = chave===sug, ehAtual = chave===atual;
      const feitas = ((u.jornadaFeitas||{})[chave]||[]).length;
      return `<div onclick="escolherTrilha('${chave}')" style="background:${ehAtual?'rgba(229,9,20,.1)':'var(--s)'};border:1px solid ${ehAtual?'var(--r)':(ehSug?m.cor:'var(--b)')};border-radius:11px;padding:13px 14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px">
        <div style="font-size:24px">${m.emoji}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px">
            ${m.nome} · ${m.ambiente==='casa'?'🏠 Casa':'🏋️ Academia'}
            ${ehSug?`<span style="font-size:8px;background:${m.cor};color:#000;padding:2px 6px;border-radius:3px;font-weight:900">SUGERIDA</span>`:''}
            ${ehAtual?'<span style="font-size:8px;background:var(--r);color:#fff;padding:2px 6px;border-radius:3px;font-weight:900">ATUAL</span>':''}
          </div>
          <div style="font-size:10.5px;color:var(--mu);margin-top:2px">${m.desc}${feitas?` · ${feitas}/10 feitas`:''}</div>
        </div>
      </div>`;
    }).join('');
  }).join('');
  abrirModal('modal-escolher-trilha');
}

function renderMissoes(){
  const u = getU(); if(!u) return;
  const el = document.getElementById('missoes-content');
  if(!el) return;

  const trilha = trilhaAtual(u);
  if(!trilha){
    const sug = metaTrilha(trilhaSugerida(u));
    el.innerHTML = `<div style="padding:30px 20px;text-align:center">
      <div style="font-size:58px;margin-bottom:14px">🎮</div>
      <div style="font-size:20px;font-weight:900;margin-bottom:8px">Jornadas FitQuest</div>
      <div style="font-size:13px;color:var(--t2);line-height:1.7;margin-bottom:20px">
        Missões que evoluem com você.<br/><strong>3 novas liberadas por semana.</strong>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px">
        ${['iniciante','intermediario','avancado'].map(n=>{
          const m = Object.values(FQ_JORNADAS.meta).find(x=>x.nivel===n);
          return `<div style="flex:1;background:var(--s);border:1px solid var(--b);border-radius:10px;padding:12px 8px">
            <div style="font-size:22px;margin-bottom:4px">${m.emoji}</div>
            <div style="font-size:11px;font-weight:800;color:${m.cor}">${m.nome}</div>
          </div>`;}).join('')}
      </div>
      ${sug?`<div style="font-size:11.5px;color:var(--t2);margin-bottom:14px">Pelo seu perfil, sugerimos: <strong style="color:${sug.cor}">${sug.emoji} ${sug.nome} · ${sug.ambiente==='casa'?'Casa':'Academia'}</strong></div>`:''}
      <button class="btn-p" onclick="abrirEscolhaTrilha()">Escolher minha jornada</button>
    </div>`;
    return;
  }

  const meta = metaTrilha(trilha);
  const missoes = missoesDaTrilha(trilha);
  const feitas = new Set((u.jornadaFeitas||{})[trilha]||[]);
  const lib = missoesLiberadas(u);
  const prox = proximaMissao(u);
  const dias = diasParaProximaLiberacao(u);
  const pct = Math.round(feitas.size/missoes.length*100);

  el.innerHTML = `
    <div style="padding:16px 20px 10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-size:26px">${meta.emoji}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:15px;font-weight:900">${meta.nome} · ${meta.ambiente==='casa'?'🏠 Casa':'🏋️ Academia'}</div>
          <div style="font-size:10.5px;color:var(--mu)">${meta.desc}</div>
        </div>
        <button onclick="abrirEscolhaTrilha()" style="background:var(--s2);border:1px solid var(--b);border-radius:7px;color:var(--t2);font-size:10px;font-weight:700;padding:6px 10px;cursor:pointer;flex-shrink:0">Trocar</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px">
        <div style="font-size:11px;color:var(--mu)">Progresso</div>
        <div style="font-size:12px;color:${meta.cor};font-weight:800">${feitas.size}/${missoes.length}</div>
      </div>
      <div style="height:6px;background:var(--s2);border-radius:3px;overflow:hidden;margin-bottom:6px">
        <div style="height:100%;width:${pct}%;background:${meta.cor};transition:width .4s"></div>
      </div>
      <div style="font-size:10.5px;color:var(--mu)">
        ${lib<missoes.length?`${lib} liberadas · próximas em ${dias} ${dias===1?'dia':'dias'}`:'Todas liberadas!'}
      </div>
    </div>
    <div style="padding:8px 20px 0">
      ${missoes.map(m=>{
        const feita = feitas.has(m.n);
        const disp = m.n <= lib;
        const ehProx = m.n === prox;
        return `<div onclick="${disp?`abrirMissao(${m.n})`:''}" style="display:flex;align-items:center;gap:12px;background:${ehProx?'rgba(229,9,20,.08)':'var(--s)'};border:1px solid ${ehProx?'rgba(229,9,20,.3)':'var(--b)'};border-radius:10px;padding:11px 13px;margin-bottom:7px;${disp?'cursor:pointer':'opacity:.4'}">
          <div style="width:30px;height:30px;border-radius:50%;background:${feita?'#2ecc71':(disp?meta.cor:'var(--s2)')};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:#fff;flex-shrink:0">${feita?'✓':(disp?m.n:'🔒')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:700;${feita?'color:var(--mu)':''}">${m.nome}</div>
            <div style="font-size:10px;color:var(--mu)">${m.dur} min · ${m.formato} · ${m.xp} XP</div>
          </div>
          ${ehProx?'<div style="font-size:9px;font-weight:800;color:var(--r);background:rgba(229,9,20,.15);padding:3px 8px;border-radius:4px;flex-shrink:0">PRÓXIMA</div>':''}
        </div>`;
      }).join('')}
    </div>
    <div style="height:80px"></div>`;
}

function abrirMissao(n){
  const u = getU(); if(!u) return;
  const trilha = trilhaAtual(u); if(!trilha) return;
  const m = missoesDaTrilha(trilha).find(x=>x.n===n);
  if(!m) return;
  if(n > missoesLiberadas(u)){ fqToast('🔒 Esta missão ainda não foi liberada.','warn'); return; }
  const meta = metaTrilha(trilha);
  const jaFeita = ((u.jornadaFeitas||{})[trilha]||[]).includes(n);

  document.getElementById('missao-detalhe-titulo').textContent = `Missão ${m.n} — ${m.nome}`;
  document.getElementById('missao-detalhe-content').innerHTML = `
    <div style="text-align:center;padding:6px 0 16px">
      <div style="display:inline-block;background:${meta.cor};color:#fff;font-size:10px;font-weight:800;padding:3px 10px;border-radius:4px;margin-bottom:8px">${meta.emoji} ${meta.nome}</div>
      <div style="display:flex;gap:14px;justify-content:center;font-size:11px;color:var(--t2)">
        <div>⏱️ ${m.dur} min</div><div>📋 ${m.formato}</div><div>⭐ ${m.xp} XP</div>
      </div>
    </div>
    ${m.blocos.map((b,bi)=>{
      const nomes = b.ex.map(id=>exNomeId(id));
      const ehMulti = b.ex.length>1;
      return `<div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-size:11px;font-weight:800;color:${meta.cor};text-transform:uppercase;letter-spacing:.5px">
            ${bi===0?'Aquecimento':(ehMulti?`${b.sets>1?b.sets+' rodadas':'Bloco'}`:`${b.sets} séries`)}
          </div>
          ${b.rest>0?`<div style="font-size:10px;color:var(--mu)">${b.rest}s descanso</div>`:''}
        </div>
        ${nomes.map((nome,ni)=>{
          const repsArr = String(b.reps).split('/').map(s=>s.trim());
          const rep = repsArr.length>1 ? (repsArr[ni]||repsArr[0]) : repsArr[0];
          return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;${ni<nomes.length-1?'border-bottom:1px solid rgba(255,255,255,.05)':''}">
            <div style="flex:1;font-size:12.5px;font-weight:600">${nome}</div>
            <div style="font-size:11.5px;font-weight:800;color:var(--r);text-align:right;flex-shrink:0;max-width:55%">${rep}</div>
          </div>`;
        }).join('')}
        ${b.nota?`<div style="font-size:10.5px;color:var(--t2);margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.05);line-height:1.5">💡 ${b.nota}</div>`:''}
      </div>`;
    }).join('')}
    <button class="btn-p" style="margin-top:8px${jaFeita?';opacity:.5':''}" onclick="concluirMissao(${m.n})" ${jaFeita?'disabled':''}>
      ${jaFeita?'✅ Missão já concluída':'✅ Concluir Missão'}
    </button>`;
  abrirModal('modal-missao');
}

function concluirMissao(n){
  const u = getU(); if(!u) return;
  const trilha = trilhaAtual(u); if(!trilha) return;
  const m = missoesDaTrilha(trilha).find(x=>x.n===n);
  if(!m) return;
  u.jornadaFeitas = u.jornadaFeitas || {};
  u.jornadaFeitas[trilha] = u.jornadaFeitas[trilha] || [];
  if(u.jornadaFeitas[trilha].includes(n)){ fqToast('Você já concluiu esta missão.','warn'); return; }

  u.jornadaFeitas[trilha].push(n);
  u.xp = (u.xp||0) + m.xp;
  u.coins = (u.coins||0) + Math.round(m.xp/5);
  const nivelAntes = u.level||1;
  u.level = Math.max(1, Math.floor((u.xp||0)/500)+1);
  u.stats = u.stats||{}; u.stats.treinos = (u.stats.treinos||0)+1;
  if(typeof atualizarStreak==='function') atualizarStreak(u);
  saveU(u);

  closeModal('modal-missao');
  fqToast(`🎉 Missão ${n} concluída! +${m.xp} XP`,'ok');
  if(typeof dispararConfete==='function') dispararConfete();
  if(u.level>nivelAntes && typeof dispararConfete==='function') setTimeout(()=>dispararConfete(),400);
  if(u.jornadaFeitas[trilha].length===missoesDaTrilha(trilha).length){
    setTimeout(()=>fqToast('🎓 Jornada completa! Que tal subir de nível?','ok'),900);
  }
  renderMissoes();
  if(typeof renderHomeMissoesCard==='function') renderHomeMissoesCard();
}

// ── Cards da Home pra escolher/gerar cada tipo de treino ──
// Só aparecem enquanto aquele plano especifico nao foi gerado ainda.
// Depois de gerado, o card some (o aluno usa a aba Treino/Corrida normalmente).
function renderHomePlanoCards(){
  const u = getU(); if(!u) return;
  const el = document.getElementById('home-plano-cards');
  if(!el) return;

  const temGym = !!(u.aiPlan && u.aiPlan.gym && Object.keys(u.aiPlan.gym).length);
  const temRun = !!(u.aiPlan && u.aiPlan.run && Object.keys(u.aiPlan.run).length);

  if(temGym && temRun){ el.innerHTML=''; return; } // os dois ja gerados, nao mostra nada

  const cardMusc = !temGym ? `
    <div onclick="iniciarAnamneseMusc()" style="flex:1;display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,rgba(229,9,20,.14),rgba(229,9,20,.04));border:1px dashed rgba(229,9,20,.45);border-radius:12px;padding:14px;cursor:pointer;min-height:64px">
      <div style="font-size:26px">🏋️</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:900;line-height:1.25" data-i18n="home.wantgym">Criar treino de musculação</div>
        <div style="font-size:10.5px;color:var(--mu);margin-top:2px" data-i18n="home.wantgym.sub">Responda 3 etapas rápidas</div>
      </div>
      <div style="font-size:18px;color:var(--r)">›</div>
    </div>` : '';

  const cardCorrida = !temRun ? `
    <div onclick="iniciarAnamneseCorrida()" style="flex:1;display:flex;align-items:center;gap:12px;background:linear-gradient(135deg,rgba(46,204,113,.12),rgba(46,204,113,.03));border:1px dashed rgba(46,204,113,.45);border-radius:12px;padding:14px;cursor:pointer;min-height:64px">
      <div style="font-size:26px">🏃</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:900;line-height:1.25" data-i18n="home.wantrun">Criar plano de corrida</div>
        <div style="font-size:10.5px;color:var(--mu);margin-top:2px" data-i18n="home.wantrun.sub">Só 2 etapas — bem rápido</div>
      </div>
      <div style="font-size:18px;color:#2ecc71">›</div>
    </div>` : '';

  el.innerHTML = `
    <div style="font-size:11px;font-weight:800;color:var(--mu);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px" data-i18n="home.addplan">➕ Adicionar ao seu plano</div>
    <div style="display:flex;flex-direction:column;gap:8px">${cardMusc}${cardCorrida}</div>`;
  try{ aplicarIdioma(); }catch(e){}
}

function renderHomeMissoesCard(){
  const u = getU(); if(!u) return;
  const el = document.getElementById('home-missoes-card');
  if(!el) return;

  const trilha = trilhaAtual(u);
  if(!trilha){
    el.innerHTML = `<div onclick="switchTab('missoes',null)" style="background:linear-gradient(135deg,rgba(46,204,113,.12),rgba(229,9,20,.12));border:1px solid rgba(229,9,20,.25);border-radius:12px;padding:16px;cursor:pointer;display:flex;align-items:center;gap:14px">
      <div style="font-size:34px">🎮</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:900;margin-bottom:3px">Jornadas FitQuest</div>
        <div style="font-size:11px;color:var(--t2);line-height:1.4">Missões no seu nível · escolha sua trilha</div>
      </div>
      <div style="font-size:18px;color:var(--r)">›</div>
    </div>`;
    return;
  }

  const meta = metaTrilha(trilha);
  const missoes = missoesDaTrilha(trilha);
  const nFeitas = missoesConcluidas(u);
  const prox = proximaMissao(u);
  const m = prox ? missoes.find(x=>x.n===prox) : null;
  const dias = diasParaProximaLiberacao(u);

  el.innerHTML = `<div onclick="switchTab('missoes',null)" style="background:var(--s);border:1px solid var(--b);border-radius:12px;padding:14px 16px;cursor:pointer">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div style="font-size:26px">${meta.emoji}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:900">${meta.nome} · ${meta.ambiente==='casa'?'Casa':'Academia'}</div>
        <div style="font-size:10.5px;color:var(--mu)">${nFeitas}/${missoes.length} missões</div>
      </div>
      <div style="font-size:18px;color:var(--r)">›</div>
    </div>
    <div style="height:5px;background:var(--s2);border-radius:3px;overflow:hidden;margin-bottom:10px">
      <div style="height:100%;width:${Math.round(nFeitas/missoes.length*100)}%;background:${meta.cor}"></div>
    </div>
    ${m
      ? `<div style="background:rgba(229,9,20,.08);border-radius:8px;padding:9px 11px;display:flex;align-items:center;gap:10px">
          <div style="font-size:10px;font-weight:800;color:var(--r);background:rgba(229,9,20,.15);padding:3px 7px;border-radius:4px">PRÓXIMA</div>
          <div style="flex:1;min-width:0;font-size:11.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${m.nome}</div>
          <div style="font-size:10px;color:var(--mu);flex-shrink:0">${m.dur}min</div>
        </div>`
      : `<div style="font-size:11px;color:var(--mu);text-align:center;padding:6px">
          ${nFeitas>=missoes.length?'🏆 Jornada completa!':`✅ Em dia — novas em ${dias} ${dias===1?'dia':'dias'}`}
        </div>`}
  </div>`;
}


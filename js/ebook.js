// ═══════════════════════════════════════════════════════════
// FITQUEST — ebook.js
// Leitor de ebook in-app e gerador de PDF personalizado.
// ═══════════════════════════════════════════════════════════


// ══════════════════════════════════════════════════════
// MOTOR DE EBOOKS PERSONALIZADOS
// Um conteúdo, dois renderizadores (leitor in-app + PDF),
// personalização real usando o perfil já sincronizado do aluno.
// ══════════════════════════════════════════════════════

function personalizarEbook(u){
  const an = u.anamnese||{};
  const nome = (u.name||'Aluno').split(' ')[0];
  const t=(an.tempo||'').toLowerCase();
  let nivel='Iniciante';
  if(t.includes('avan'))nivel='Avançado';
  else if(t.includes('intermedi'))nivel='Intermediário';
  else if(t.includes('nunca'))nivel='Destreinado';
  const objetivo=(an.obj||[])[0]||'Saúde geral';
  const lesoes=[];
  if(an.temJoelho)lesoes.push('joelho');
  if(an.temLombar)lesoes.push('lombar');
  if(an.temOmbro)lesoes.push('ombro');
  const peso=an.peso?parseFloat(an.peso):null;
  const prs=u.prs||[];
  return {nome,nivel,objetivo,lesoes,peso,prs,dias:an.dias||'—'};
}

// Acha um PR relevante pelo nome do exercício (match por primeira palavra-chave)
function prParaExercicio(perfil,nomeExercicio){
  if(!perfil.prs||!perfil.prs.length)return null;
  const chave=(nomeExercicio||'').toLowerCase().split(' ')[0];
  return perfil.prs.find(p=>p.exercise&&p.exercise.toLowerCase().includes(chave))||null;
}

// Filtra/anota linhas de tabela contraindicadas pela lesão do aluno (reusa padrões do Motor Rennan Dias)
function anotarLinhaTabela(perfil,linha){
  const nome=(linha[0]||'').toLowerCase();
  let aviso=null;
  if(perfil.lesoes.includes('joelho')&&/agachamento livre|hack squat|leg press|extensora|avanço|salto/i.test(nome))
    aviso='⚠️ Substitua — você indicou lesão de joelho';
  else if(perfil.lesoes.includes('lombar')&&/terra|stiff|remada curvada|extensão lombar/i.test(nome))
    aviso='⚠️ Substitua — você indicou lesão lombar';
  else if(perfil.lesoes.includes('ombro')&&/desenvolvimento|elevação lateral|elevação frontal/i.test(nome))
    aviso='⚠️ Ajuste amplitude — você indicou lesão de ombro';
  return {linha, aviso}; // objeto explícito — nunca corrompe o array original
}


// ══════════════════════════════════════════════════════
// RENDERIZADOR DO LEITOR IN-APP
// ══════════════════════════════════════════════════════

let EB_ATUAL = null; // {key, book, perfil, capIndex}

function openEbook(programId){
  const file = EBOOKS_CONTENT[programId];
  const u = getU ? getU() : null;
  if(!file || !u){ fqToast('📕 E-Book ainda não disponível.','warn'); return; }

  const p = CATALOG.find(cc => cc.id === programId);
  document.getElementById('ebook-title-bar').textContent = p ? p.title : file.titulo;

  const modal = document.getElementById('modal-ebook');
  modal.classList.add('open');
  _pushNavState('modal:modal-ebook');
  document.body.style.overflow = 'hidden';

  const perfil = personalizarEbook(u);
  const users = DB.get('fq_users')||{};
  const progresso = (users[u.email]&&users[u.email].ebooksProgresso&&users[u.email].ebooksProgresso[programId])||0;

  EB_ATUAL = {key: programId, book: file, perfil, capIndex: -1}; // -1 = capa
  document.documentElement.style.setProperty('--eb-cor-atual', file.cor);
  ebRenderCapa(progresso);
}

function ebSalvarProgresso(idx){
  const email = DB.get('fq_cur'); const users = DB.get('fq_users')||{};
  const u = users[email]; if(!u) return;
  if(!u.ebooksProgresso) u.ebooksProgresso = {};
  const atual = u.ebooksProgresso[EB_ATUAL.key]||0;
  u.ebooksProgresso[EB_ATUAL.key] = Math.max(atual, idx);
  DB.set('fq_users', users);
  if(typeof syncU==='function') syncU(u).catch(()=>{});
}

function ebRenderCapa(progresso){
  const {book, perfil} = EB_ATUAL;
  const el = document.getElementById('eb-reader-container');
  el.style.setProperty('--eb-cor', book.cor);
  const chipsLesao = perfil.lesoes.length
    ? perfil.lesoes.map(l=>`<span class="eb-chip warn">⚠️ ${l}</span>`).join('')
    : '';
  el.innerHTML = `
    <div class="eb-cover" style="--eb-cor:${book.cor}">
      <div class="eb-cover-emoji">${book.emoji}</div>
      <div class="eb-cover-title">${book.titulo}</div>
      <div class="eb-cover-sub">${book.subtitulo}</div>
      <div class="eb-cover-tagline">${book.tagline}</div>
    </div>
    <div class="eb-perfil-card">
      <div class="eb-perfil-titulo">✨ Personalizado para você</div>
      <div class="eb-perfil-saudacao">Preparado especialmente para ${perfil.nome}</div>
      <div class="eb-chips">
        <span class="eb-chip">📊 Nível: ${perfil.nivel}</span>
        <span class="eb-chip">🎯 ${perfil.objetivo}</span>
        ${perfil.peso?`<span class="eb-chip">⚖️ ${perfil.peso}kg</span>`:''}
        ${chipsLesao}
      </div>
    </div>
    <button class="eb-start-btn" style="--eb-cor:${book.cor}" onclick="ebIrCapitulo(${progresso>0?progresso:0})">
      ${progresso>0?'📖 Continuar de onde parou':'📖 Começar Leitura'}
    </button>
    <div class="eb-toc">
      <div class="eb-perfil-titulo" style="margin:20px 0 10px">Sumário</div>
      ${book.capitulos.map((cap,i)=>`
        <div class="eb-toc-item" onclick="ebIrCapitulo(${i})">
          <div class="eb-toc-num" style="background:${book.cor}">${i+1}</div>
          <div class="eb-toc-titulo">${cap.titulo}</div>
          ${progresso>i?'<div class="eb-toc-check">✓</div>':''}
        </div>`).join('')}
    </div>
    <div style="height:24px"></div>
  `;
  el.scrollTop = 0;
}

function ebRenderSecao(sec, perfil){
  switch(sec.tipo){
    case 'subtitulo':
      return `<div class="eb-subtitulo">${sec.texto}</div>`;
    case 'texto':
      return `<div class="eb-texto">${sec.corpo}</div>`;
    case 'estudo':
      return `<div class="eb-estudo"><div class="eb-estudo-fonte">🔬 ${sec.fonte}</div><div class="eb-estudo-texto">${sec.texto}</div></div>`;
    case 'bloco_titulo':
      return `<div class="eb-bloco">${sec.texto}</div>`;
    case 'lista':
      return `<ul class="eb-lista">${sec.itens.map(it=>`<li>${it}</li>`).join('')}</ul>`;
    case 'tabela':{
      const anotadas = sec.linhas.map(l=>anotarLinhaTabela(perfil,l));
      const cols = sec.colunas.length?sec.colunas:['Exercício','Séries','Reps','Descanso','RPE'];
      return `<div class="eb-tabela-titulo">${sec.titulo}</div>
        <div class="eb-tabela-wrap"><table class="eb-tabela">
          <thead><tr>${cols.map(cc=>`<th>${cc}</th>`).join('')}</tr></thead>
          <tbody>${anotadas.map(({linha,aviso})=>{
            const pr = prParaExercicio(perfil, linha[0]);
            return `<tr>${linha.slice(0,cols.length).map((v,ci)=>`<td class="${aviso&&ci===0?'eb-tabela-aviso':''}">${v}${ci===0&&aviso?'<br><span style="font-size:9px">'+aviso+'</span>':''}${ci===0&&pr?`<span class="eb-tabela-pr">✓ Seu recorde: ${pr.value}</span>`:''}</td>`).join('')}</tr>`;
          }).join('')}</tbody>
        </table></div>`;
    }
    default: return '';
  }
}

function ebIrCapitulo(idx){
  const {book, perfil} = EB_ATUAL;
  if(idx<0||idx>=book.capitulos.length)return;
  EB_ATUAL.capIndex = idx;
  ebSalvarProgresso(idx+1);
  const cap = book.capitulos[idx];
  const pct = Math.round(((idx+1)/book.capitulos.length)*100);
  const el = document.getElementById('eb-reader-container');
  el.innerHTML = `
    <div class="eb-cap-hdr">
      <div class="eb-cap-progress"><div class="eb-cap-progress-fill" style="width:${pct}%;background:${book.cor}"></div></div>
      <div class="eb-cap-eyebrow" style="color:${book.cor}">Capítulo ${idx+1} de ${book.capitulos.length}</div>
      <div class="eb-cap-titulo">${cap.titulo}</div>
    </div>
    <div class="eb-body">
      ${cap.secoes.map(s=>ebRenderSecao(s,perfil)).join('')}
    </div>
    <div class="eb-nav">
      <button class="eb-nav-btn" ${idx===0?'disabled':''} onclick="ebIrCapitulo(${idx-1})">← Anterior</button>
      ${idx<book.capitulos.length-1
        ? `<button class="eb-nav-btn primary" style="background:${book.cor};border-color:${book.cor}" onclick="ebIrCapitulo(${idx+1})">Próximo →</button>`
        : `<button class="eb-nav-btn primary" style="background:${book.cor};border-color:${book.cor}" onclick="ebRenderCapa(${book.capitulos.length})">✓ Concluir</button>`}
    </div>
  `;
  el.scrollTop = 0;
}


// ══════════════════════════════════════════════════════
// GERADOR DE PDF PERSONALIZADO (jsPDF + autoTable)
// ══════════════════════════════════════════════════════

function ebHexToRgb(hex){
  hex = hex.replace('#','');
  return [parseInt(hex.substring(0,2),16), parseInt(hex.substring(2,4),16), parseInt(hex.substring(4,6),16)];
}

async function baixarEbookPDF(){
  if(!EB_ATUAL){ fqToast('Abra um e-book primeiro','warn'); return; }
  if(typeof window.jspdf === 'undefined'){ fqToast('Gerador de PDF indisponível — verifique sua conexão e tente novamente.','warn'); return; }

  fqToast('Gerando seu PDF personalizado...','ok');
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({unit:'mm', format:'a4'});
  const { book, perfil } = EB_ATUAL;
  const W = 210, H = 297;
  const [r,g,b] = ebHexToRgb(book.cor);

  // ── CAPA ──
  doc.setFillColor(10,10,10); doc.rect(0,0,W,H,'F');
  doc.setFillColor(r,g,b); doc.rect(0,0,W,4,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(book.titulo.toUpperCase(), 160);
  doc.text(titleLines, W/2, 85, {align:'center'});
  let capY = 85 + titleLines.length*11;
  doc.setFontSize(13); doc.setTextColor(r,g,b);
  doc.text(book.subtitulo, W/2, capY, {align:'center'});
  capY += 10;
  doc.setFontSize(9); doc.setTextColor(180,180,180); doc.setFont('helvetica','normal');
  const taglineLines = doc.splitTextToSize(book.tagline, 140);
  doc.text(taglineLines, W/2, capY, {align:'center'});

  doc.setDrawColor(r,g,b); doc.setLineWidth(0.6);
  doc.roundedRect(25, 155, W-50, 42, 3, 3);
  doc.setTextColor(255,255,255); doc.setFontSize(12); doc.setFont('helvetica','bold');
  doc.text('Preparado especialmente para ' + perfil.nome, W/2, 168, {align:'center'});
  doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(210,210,210);
  let infoLine = 'Nível: ' + perfil.nivel + '   |   Objetivo: ' + perfil.objetivo;
  if(perfil.peso) infoLine += '   |   ' + perfil.peso + 'kg';
  doc.text(infoLine, W/2, 178, {align:'center'});
  if(perfil.lesoes.length){
    doc.setTextColor(243,156,18);
    doc.text('Atenção — lesão considerada: ' + perfil.lesoes.join(', '), W/2, 186, {align:'center'});
  }

  doc.setFontSize(10); doc.setTextColor(150,150,150); doc.setFont('helvetica','normal');
  doc.text('Rennan Dias — Personal Trainer | CREF', W/2, 265, {align:'center'});
  doc.setFontSize(8);
  doc.text('FitQuest — rennandias.com.br', W/2, 278, {align:'center'});

  // ── CAPÍTULOS ──
  book.capitulos.forEach((cap, ci) => {
    doc.addPage();
    let y = 26;
    doc.setFillColor(r,g,b); doc.rect(0,0,W,16,'F');
    doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('CAPÍTULO ' + (ci+1) + ': ' + cap.titulo.toUpperCase(), 15, 10.5);

    cap.secoes.forEach(sec => {
      if(y > 268){ doc.addPage(); y = 20; }
      if(sec.tipo === 'subtitulo'){
        doc.setFont('helvetica','bold'); doc.setFontSize(11.5); doc.setTextColor(r,g,b);
        const lines = doc.splitTextToSize(sec.texto, 180);
        doc.text(lines, 15, y); y += lines.length*6 + 3;
      } else if(sec.tipo === 'texto'){
        doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(60,60,60);
        const lines = doc.splitTextToSize(sec.corpo, 180);
        lines.forEach(line => { if(y>278){doc.addPage();y=20;} doc.text(line, 15, y); y += 5; });
        y += 4;
      } else if(sec.tipo === 'estudo'){
        const lines = doc.splitTextToSize(sec.texto, 165);
        const boxH = 11 + lines.length*4.3;
        if(y + boxH > 280){ doc.addPage(); y = 20; }
        doc.setFillColor(233,250,240); doc.setDrawColor(46,204,113); doc.setLineWidth(0.7);
        doc.roundedRect(15, y, 180, boxH, 2, 2, 'FD');
        doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.setTextColor(24,120,68);
        doc.text('ESTUDO: ' + sec.fonte, 19, y+6);
        doc.setFont('helvetica','normal'); doc.setFontSize(8.3); doc.setTextColor(60,60,60);
        doc.text(lines, 19, y+11);
        y += boxH + 6;
      } else if(sec.tipo === 'bloco_titulo'){
        if(y+10>280){doc.addPage();y=20;}
        doc.setFillColor(r,g,b); doc.rect(15, y-4.5, 180, 8, 'F');
        doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(255,255,255);
        doc.text(sec.texto, 19, y+0.5); y += 12;
      } else if(sec.tipo === 'lista'){
        doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(60,60,60);
        sec.itens.forEach(item => {
          const lines = doc.splitTextToSize('•  ' + item, 175);
          lines.forEach(line=>{ if(y>278){doc.addPage();y=20;} doc.text(line, 17, y); y += 4.8; });
          y += 2;
        });
        y += 3;
      } else if(sec.tipo === 'tabela'){
        if(sec.titulo){
          if(y > 262){ doc.addPage(); y = 20; }
          doc.setFont('helvetica','bold'); doc.setFontSize(9.5); doc.setTextColor(r,g,b);
          doc.text(sec.titulo, 15, y); y += 5;
        }
        const cols = sec.colunas.length ? sec.colunas : ['Exercício','Séries','Reps','Descanso','RPE'];
        const anotadas = sec.linhas.map(l => anotarLinhaTabela(perfil, l));
        doc.autoTable({
          startY: y,
          head: [cols],
          body: anotadas.map(a => a.linha.slice(0, cols.length)),
          theme: 'striped',
          headStyles: {fillColor:[r,g,b], textColor:[255,255,255], fontSize:8, fontStyle:'bold'},
          bodyStyles: {fontSize:8, textColor:[60,60,60]},
          alternateRowStyles: {fillColor:[245,245,245]},
          margin: {left:15, right:15},
          didParseCell: function(data){
            if(data.section==='body' && data.column.index===0){
              const a = anotadas[data.row.index];
              if(a && a.aviso){
                data.cell.styles.fillColor=[255,243,224];
                data.cell.styles.textColor=[180,110,0];
              }
            }
          }
        });
        y = doc.lastAutoTable.finalY + 8;
      }
    });

    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(150,150,150);
    doc.text('FitQuest — Rennan Dias Assessoria Esportiva · rennandias.com.br', W/2, 292, {align:'center'});
  });

  const safeName = (perfil.nome||'Aluno').replace(/[^\w]/g,'');
  const safeTitle = (book.titulo||'Ebook').replace(/[^\w]/g,'-');
  doc.save('FitQuest-' + safeTitle + '-' + safeName + '.pdf');
  fqToast('📄 PDF personalizado baixado!','ok');
}



// ── (movido do <head> do index.html original) ──
function closeEbook() {
  const modal = document.getElementById('modal-ebook');
  modal.classList.remove('open');
  document.body.style.overflow = '';
  EB_ATUAL = null;
  if(!_fqNavegandoViaVoltar){
    _fqConsumindoHistorico=true;
    try{ history.back(); }catch(e){ _fqConsumindoHistorico=false; }
  }
}

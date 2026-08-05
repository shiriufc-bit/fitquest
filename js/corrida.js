// ═══════════════════════════════════════════════════════════
// FITQUEST — corrida.js
// Motor de geração do programa de corrida e rastreador
// de GPS em tempo real.
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// MOTOR DE CORRIDA v3 — baseado na metodologia real do Rennan Dias
// 153 treinos catalogados + 12 planos periodizados (nível × distância)
// extraídos da planilha profissional. Fiel ao original, personalizado
// por ritmo estimado do aluno (Karvonen adaptado às zonas do Rennan).
// ══════════════════════════════════════════════════════════════

const RD_ZONA_PCT={Z1:0.65,Z2:0.75,Z3:0.85,Z4:0.95,Z5:1.05};
const RD_ZONA_NOME={Z1:'Muito Leve',Z2:'Leve',Z3:'Moderado',Z4:'Forte',Z5:'Muito Forte'};

function RD_fmtPace(p){
  let m=Math.floor(p),s=Math.round((p-m)*60);
  if(s===60){m+=1;s=0;}
  return `${m}:${String(s).padStart(2,'0')}/km`;
}
function RD_distParaMin(km,zona,testPace){
  return km*(testPace/RD_ZONA_PCT[zona]);
}

function RD_parseTreino(codigo,testPace){
  const t=RD_TREINOS_DB[codigo];
  if(!t)return null;
  const principal=(t.principal||'').toUpperCase().trim();
  let segs=[];

  // Padrão A: segmentos explícitos em TEMPO "X' ZONA (ZN) + Y' ZONA (ZN)"
  const reTimeSegs=/(\d+)'\s*\w+\s*\(Z(\d)\)/g;
  let mTimeSegs=[...principal.matchAll(reTimeSegs)];
  if(principal.includes('+')&&mTimeSegs.length>=2){
    mTimeSegs.forEach((m,i)=>{
      const zona='Z'+m[2];
      segs.push({label:`Bloco ${i+1}`,min:parseInt(m[1]),zona,ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]})`});
    });
    return segs;
  }

  // Padrão B: segmentos explícitos em KM "XKM ... (ZN) + YKM ... (ZN)" (pirâmide)
  const reKmSegs=/(\d+(?:[.,]\d+)?)\s*KM(?:(?!KM).)*?\(Z(\d)\)/g;
  let mKmSegs=[...principal.matchAll(reKmSegs)];
  if(principal.includes('+')&&mKmSegs.length>=2){
    mKmSegs.forEach((m,i)=>{
      const zona='Z'+m[2];const kmv=parseFloat(m[1].replace(',','.'));
      const mins=Math.round(RD_distParaMin(kmv,zona,testPace));
      segs.push({label:`Bloco ${i+1} (${kmv}km)`,min:mins,zona,ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]})`});
    });
    return segs;
  }

  // Padrão C: FARTLEK "Xkm INTERCALANDO Aunit FORTE(Z4) X Bunit LEVE(Z2)"
  let m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*INTERCALANDO\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*\w*\(Z(\d)\)\s*X\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*\w*\(Z(\d)\)/);
  if(m){
    let [,totalKm,d1,u1,z1,d2,u2,z2]=m;
    d1=parseFloat(d1.replace(',','.'))/(u1==='M'?1000:1);
    d2=parseFloat(d2.replace(',','.'))/(u2==='M'?1000:1);
    totalKm=parseFloat(totalKm.replace(',','.'));
    const ciclo=d1+d2;const nCiclos=Math.max(1,Math.round(totalKm/ciclo));
    const zona1='Z'+z1,zona2='Z'+z2;
    const min1=RD_distParaMin(d1,zona1,testPace),min2=RD_distParaMin(d2,zona2,testPace);
    segs.push({label:`${nCiclos}× (${Math.round(d1*1000)}m forte + ${Math.round(d2*1000)}m leve)`,
      min:Math.round((min1+min2)*nCiclos),zona:zona1,
      ref:`Alternando ${RD_fmtPace(testPace/RD_ZONA_PCT[zona1])} / ${RD_fmtPace(testPace/RD_ZONA_PCT[zona2])} · ${zona1}/${zona2}`});
    return segs;
  }

  // Padrão D1: "N TIROS DE Xunit (Z5) x RECUPERAÇÃO Y MIN/unit"
  m=principal.match(/(\d+)\s*TIROS\s*DE\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*\(Z(\d)\).*?RECUPERA[ÇC][ÃA]O.*?(\d+(?:[.,]\d+)?)\s*(MINUTOS?|M|KM)/);
  if(m){
    let [,n,d,u,z,rec,recU]=m;
    n=parseInt(n);d=parseFloat(d.replace(',','.'))/(u==='M'?1000:1);const zona='Z'+z;
    const minTiro=RD_distParaMin(d,zona,testPace);
    const minRec=/MIN/.test(recU)?parseFloat(rec.replace(',','.')):RD_distParaMin(parseFloat(rec.replace(',','.'))/(recU==='M'?1000:1),'Z1',testPace);
    segs.push({label:`${n}× ${Math.round(d*1000)}m forte + recuperação`,min:Math.round((minTiro+minRec)*n),zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]}) + trote leve`});
    return segs;
  }

  // Padrão D2: "Xkm - TIROS DE Yunit (Z5) x RECUPERAÇÃO DE Zunit" (total dividido em reps)
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM.*?TIROS\s*DE\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*\(Z(\d)\).*?RECUPERA[ÇC][ÃA]O.*?(\d+(?:[.,]\d+)?)\s*(M|KM|MINUTOS?)/);
  if(m){
    let [,total,d,u,z,rec,recU]=m;
    total=parseFloat(total.replace(',','.'));d=parseFloat(d.replace(',','.'))/(u==='M'?1000:1);const zona='Z'+z;
    const isMin=/MIN/.test(recU);
    const recKm=isMin?null:parseFloat(rec.replace(',','.'))/(recU==='M'?1000:1);
    const ciclo=d+(recKm||0.15);const n=Math.max(2,Math.round(total/ciclo));
    const minTiro=RD_distParaMin(d,zona,testPace);
    const minRec=isMin?parseFloat(rec.replace(',','.')):RD_distParaMin(recKm,'Z1',testPace);
    segs.push({label:`${n}× ${Math.round(d*1000)}m forte + recuperação`,min:Math.round((minTiro+minRec)*n),zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]}) + trote leve`});
    return segs;
  }

  // Padrão D3: intervalado em TEMPO "N MIN - TIROS DE X' (Z5) x RECUPERAÇÃO DE Y'"
  m=principal.match(/TIROS\s*DE\s*(\d+(?:[.,]\d+)?)\s*'\s*\(Z(\d)\).*?RECUPERA[ÇC][ÃA]O.*?(\d+(?:[.,]\d+)?)\s*'/);
  if(m){
    let [,d,z,rec]=m;d=parseFloat(d.replace(',','.'));const zona='Z'+z;rec=parseFloat(rec.replace(',','.'));
    const mTotal=principal.match(/^(\d+)\s*MIN/);
    const total=mTotal?parseFloat(mTotal[1]):20;
    const n=Math.max(2,Math.round(total/(d+rec)));
    segs.push({label:`${n}× (${d}min forte + ${rec}min recuperação)`,min:Math.round(total),zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]}) + trote leve`});
    return segs;
  }

  // Padrão D4: "N X TIROS DE Xm (Z5) X Y MIN RECUPERANDO"
  m=principal.match(/(\d+)\s*X\s*TIROS\s*DE\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*\(Z(\d)\)\s*X\s*(\d+(?:[.,]\d+)?)\s*MIN/);
  if(m){
    let [,n,d,u,z,rec]=m;
    n=parseInt(n);d=parseFloat(d.replace(',','.'))/(u==='M'?1000:1);const zona='Z'+z;rec=parseFloat(rec.replace(',','.'));
    const minTiro=RD_distParaMin(d,zona,testPace);
    segs.push({label:`${n}× ${Math.round(d*1000)}m forte + recuperação`,min:Math.round((minTiro+rec)*n),zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]}) + trote leve`});
    return segs;
  }

  // Padrão E: PROGRESSIVO "Xkm AUMENTANDO INTENSIDADE A CADA Ykm"
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*AUMENTANDO\s*INTENSIDADE\s*A\s*CADA\s*(\d+(?:[.,]\d+)?)\s*KM/);
  if(m){
    const total=parseFloat(m[1].replace(',','.')),passo=parseFloat(m[2].replace(',','.'));
    const nBlocos=Math.max(2,Math.round(total/passo));
    const zonasProg=['Z2','Z3','Z4','Z5'];
    for(let i=0;i<nBlocos;i++){
      const zona=zonasProg[Math.min(i,zonasProg.length-1)];
      const mins=Math.round(RD_distParaMin(passo,zona,testPace));
      segs.push({label:`${passo}km — bloco ${i+1}/${nBlocos}`,min:mins,zona,
        ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]})`});
    }
    return segs;
  }

  // Padrão F: RITMO "Xkm ... N A M SEGUNDOS MAIS RÁPIDO QUE Z3"
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*(?:RITMO\s*)?\d+\s*A\s*\d+\s*SEGUNDOS\s*MAIS\s*R[ÁA]PIDO\s*QUE\s*Z(\d)/);
  if(m){
    const km=parseFloat(m[1].replace(',','.'));const zona='Z'+m[2];
    const paceAj=testPace/RD_ZONA_PCT[zona]-0.1;
    segs.push({label:`${km}km em ritmo de prova`,min:Math.round(km*paceAj),zona,
      ref:`${RD_fmtPace(paceAj)} · um pouco mais rápido que ${zona}`});
    return segs;
  }

  // Padrão G1: "N X (Xunit CORRENDO X Yunit CAMINHANDO)"
  m=principal.match(/(\d+)\s*X\s*\(\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*CORRENDO\s*X\s*(\d+(?:[.,]\d+)?)\s*(M|KM)\s*CAMINHANDO/);
  if(m){
    let [,n,run,ru,walk,wu]=m;
    n=parseInt(n);run=parseFloat(run.replace(',','.'))/(ru==='M'?1000:1);walk=parseFloat(walk.replace(',','.'))/(wu==='M'?1000:1);
    const minRun=RD_distParaMin(run,'Z2',testPace),minWalk=walk*9.5;
    segs.push({label:`${n}× (${Math.round(run*1000)}m correndo + ${Math.round(walk*1000)}m caminhando)`,
      min:Math.round((minRun+minWalk)*n),zona:'Z2',ref:'Alternado corrida leve / caminhada · Z1-Z2'});
    return segs;
  }

  // Padrão G2: run/walk geral, bem permissivo — não depende de achar a palavra exata
  // CORRENDO/CORRIDA/FORTE, só precisa de 2 distâncias/tempos separados por X ou + com
  // "CAMIN" depois (cobre "CORRENDO LEVE", "MAIS FORTE", "DE CORRIDA", etc.)
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*(KM|MIN)[:\s-]*.*?(\d+(?:[.,]\d+)?)\s*(M|KM|'|MIN)[^X+\d]*?(?:X|\+)\s*(\d+(?:[.,]\d+)?)\s*(M|KM|'|"|MIN)[^.]*?CAMIN/);
  if(m){
    let [,total,tu,run,ru,walk,wu]=m;
    total=parseFloat(total.replace(',','.'));run=parseFloat(run.replace(',','.'));walk=parseFloat(walk.replace(',','.'));
    if(ru==='KM')run*=1000; if(wu==='KM')walk*=1000; // normaliza tudo pra metros
    if(tu==='KM'){
      const cicloKm=(run+walk)/1000;const nCiclos=Math.max(1,Math.round(total/cicloKm));
      const minRun=RD_distParaMin(run/1000,'Z2',testPace),minWalk=(walk/1000)*9.5;
      segs.push({label:`${nCiclos}× (${Math.round(run)}m correndo + ${Math.round(walk)}m caminhando)`,
        min:Math.round((minRun+minWalk)*nCiclos),zona:'Z2',ref:'Alternado corrida leve / caminhada · Z1-Z2'});
    }else{
      const cicloMin=run+walk;const nCiclos=Math.max(1,Math.round(total/cicloMin));
      segs.push({label:`${nCiclos}× (${Math.round(run)}min correndo + ${Math.round(walk)}min caminhando)`,
        min:Math.round(total),zona:'Z2',ref:'Alternado corrida leve / caminhada · Z1-Z2'});
    }
    return segs;
  }

  // Padrão H: simples "RODAGEM/TROTE DE Xkm ... ZONA"
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM(?:(?!KM).)*?Z(\d)/);
  if(m){
    const km=parseFloat(m[1].replace(',','.'));const zona='Z'+m[2];
    segs.push({label:`${km}km contínuos`,min:Math.round(RD_distParaMin(km,zona,testPace)),zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]})`});
    return segs;
  }

  // Padrão I: tempo simples "TROTE DE X MINUTOS ... Z2"
  m=principal.match(/(\d+)\s*MINUTOS?(?:(?!MINUTOS?).)*?Z(\d)/);
  if(m){
    const mins=parseInt(m[1]);const zona='Z'+m[2];
    segs.push({label:`${mins}min contínuos`,min:mins,zona,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zona])} · ${zona} (${RD_ZONA_NOME[zona]})`});
    return segs;
  }

  // Padrão J: PROVA "Xkm DE CORRIDA"
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*DE\s*CORRIDA/);
  if(m){
    const km=parseFloat(m[1].replace(',','.'));
    segs.push({label:`Prova — ${km}km`,min:Math.round(RD_distParaMin(km,'Z3',testPace)),zona:'Z3',
      ref:'Ritmo de prova — o que o corpo permitir no dia'});
    return segs;
  }

  // Caso especial: "Xkm CORRENDO + Y' PARADO + Zkm CORRENDO" (corrida interrompida por parada)
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*CORRENDO\s*\+\s*(\d+(?:[.,]\d+)?)\s*'\s*PARADO\s*\+\s*(\d+(?:[.,]\d+)?)\s*KM\s*CORRENDO/);
  if(m){
    const [,d1,pausa,d2]=m.map(x=>x?parseFloat(x.replace(',','.')):x);
    segs.push({label:`${d1}km contínuos`,min:Math.round(RD_distParaMin(d1,'Z2',testPace)),zona:'Z2',
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT.Z2)} · Z2 (Leve)`});
    segs.push({label:`Pausa de ${pausa}min`,min:Math.round(pausa),zona:'Z1',ref:'Parado, recuperando'});
    segs.push({label:`${d2}km contínuos`,min:Math.round(RD_distParaMin(d2,'Z2',testPace)),zona:'Z2',
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT.Z2)} · Z2 (Leve)`});
    return segs;
  }

  // Caso especial: prosa livre "Xkm correndo, caminhe quando precisar"
  m=principal.match(/(\d+(?:[.,]\d+)?)\s*KM\s*CORRENDO.*?CAMINHAR/);
  if(m){
    const km=parseFloat(m[1].replace(',','.'));
    segs.push({label:`${km}km — corra o máximo possível`,min:Math.round(RD_distParaMin(km,'Z2',testPace)),zona:'Z2',
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT.Z2)} · Z2 (Leve) — caminhe 1min sempre que precisar, sem culpa`});
    return segs;
  }

  // Caso especial: TESTE de pista
  if(principal.includes('MAIS RÁPIDO QUE CONSEGUIR')){
    segs.push({label:'Teste — 3.200m o mais rápido possível',min:Math.round(3.2*testPace/1.05),zona:'Z5',
      ref:'Esforço máximo — este resultado define suas zonas reais'});
    return segs;
  }

  // Fallback genérico
  let mFbKm=principal.match(/(\d+(?:[.,]\d+)?)\s*KM/);
  let mFbMin=principal.match(/(\d+)\s*(?:MIN|')/);
  let mFbZ=principal.match(/Z(\d)/);
  const zonaFb=mFbZ?'Z'+mFbZ[1]:'Z2';
  if(mFbKm){
    const km=parseFloat(mFbKm[1].replace(',','.'));
    segs.push({label:t.principal,min:Math.round(RD_distParaMin(km,zonaFb,testPace)),zona:zonaFb,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zonaFb])} · ${zonaFb} (${RD_ZONA_NOME[zonaFb]})`});
    return segs;
  }
  if(mFbMin){
    segs.push({label:t.principal,min:parseInt(mFbMin[1]),zona:zonaFb,
      ref:`${RD_fmtPace(testPace/RD_ZONA_PCT[zonaFb])} · ${zonaFb} (${RD_ZONA_NOME[zonaFb]})`});
    return segs;
  }
  return null;
}

// ══ FORMATO DE APRESENTAÇÃO DOS TREINOS DE CORRIDA ══
// Blocos limpos em CAIXA ALTA, sem anotação de zona e sem explicação extra:
//   5 MIN TROTE
//   RODAGEM DE 6KM (MODERADO)
//   5 MIN TROTE
function RD_limparTexto(txt){
  if(!txt) return '';
  let t = String(txt).toUpperCase().trim();
  t = t.replace(/\s*\(Z\d(?:\s*\/\s*Z\d)?\)/g, '');   // (Z4), (Z1/Z2)
  t = t.replace(/\s+EM\s+Z\d\b/g, '');                   // "EM Z3"
  t = t.replace(/\s+ENTRE\s+Z\d\s+E\s+Z\d\b/g, '');   // "ENTRE Z2 E Z3"
  t = t.replace(/\bZ\d\s*\/\s*Z\d\b/g, '');            // Z1/Z2 solto
  t = t.replace(/\bZ\d\b/g, '');                          // Z3 solto
  t = t.replace(/\s*-\s*$/,'');
  t = t.replace(/\s{2,}/g,' ').replace(/\s+\)/g,')').replace(/\(\s+/g,'(');
  return t.replace(/\s*,\s*$/,'').trim();
}

// Monta os blocos de um treino: aquecimento, parte principal, volta à calma
function RD_blocosTreino(t){
  const blocos = [];
  const aq = RD_limparTexto(t.aquecimento);
  if(aq && aq !== 'NÃO') blocos.push(aq);
  const principal = RD_limparTexto(t.principal);
  if(principal) blocos.push(principal);
  const esf = RD_limparTexto(t.esfriamento);
  if(esf && esf !== 'NÃO') blocos.push(esf);
  return blocos;
}

function RD_montarSessao(codigo,dia,testPace){
  const t=RD_TREINOS_DB[codigo];
  if(!t)return null;
  const segsPrincipais=RD_parseTreino(codigo,testPace)||[];
  const segmentos=[];
  const aqTxt=(t.aquecimento||'').toUpperCase().trim();
  if(aqTxt&&aqTxt!=='NÃO'){
    const m=aqTxt.match(/(\d+)/);
    segmentos.push({label:'Aquecimento',min:m?parseInt(m[1]):5,zona:'Z1',ref:'Trote bem leve · Z1'});
  }
  segmentos.push(...segsPrincipais);
  const esfTxt=(t.esfriamento||'').toUpperCase().trim();
  if(esfTxt&&esfTxt!=='NÃO'){
    const m=esfTxt.match(/(\d+)/);
    segmentos.push({label:'Desaceleração',min:m?parseInt(m[1]):5,zona:'Z1',ref:'Trote leve / caminhada · Z1'});
  }
  const durTotal=segmentos.reduce((a,s)=>a+s.min,0);
  const distKm=segsPrincipais.reduce((a,s)=>a+s.min/(testPace/RD_ZONA_PCT[s.zona]),0);
  return {dia,tipo:t.tipo,texto:t.principal,blocos:RD_blocosTreino(t),segmentos,distKm:Math.round(distKm*10)/10,durMin:durTotal};
}

const RD_DIA_ABREV={segunda:'Seg',terça:'Ter',quarta:'Qua',quinta:'Qui',sexta:'Sex',sábado:'Sáb',domingo:'Dom'};
const RD_TIPO_TITULO={
  RODAGEM:'Rodagem',FARTLEK:'Fartlek (Ritmo Variado)',INTERVALADO:'Intervalado (Tiros)',
  PROGRESSIVO:'Progressivo (Intensidade Crescente)',TROTE:'Trote Leve',LONGO:'Longão',
  MISTO:'Pirâmide',RITMO:'Ritmo de Prova',PROVA:'🏁 Prova',INICIANTE:'Corrida + Caminhada',
  TESTE:'Teste de Avaliação',CAMINHADA:'Caminhada'
};
const RD_TIPO_DICA={
  RODAGEM:'Ritmo constante, controlado. Se não consegue manter a conversa, está rápido demais.',
  FARTLEK:'Brinque com o ritmo — use referências no percurso em vez de cronômetro rígido.',
  INTERVALADO:'Recuperação sempre em trote leve, nunca parado — mantém o corpo ativo entre os tiros.',
  PROGRESSIVO:'Comece bem controlado — o objetivo é terminar mais forte, não começar forte.',
  TROTE:'Ritmo bem leve, de recuperação. Serve pra circular o sangue, não pra treinar forte.',
  LONGO:'O treino mais importante da semana pra resistência. Regra dos 10%: nunca aumente demais de uma vez.',
  MISTO:'A pirâmide sobe e desce de intensidade — respeite o ritmo de cada trecho.',
  RITMO:'Este é o ritmo que você vai sustentar no dia da prova — grave essa sensação.',
  PROVA:'Chegou o grande dia! Confie no processo das últimas semanas.',
  INICIANTE:'Alternar corrida e caminhada é o caminho certo pra construir resistência sem lesão.',
  TESTE:'Esforço máximo neste teste — o resultado vai calibrar seus ritmos de treino reais.',
  CAMINHADA:'Recuperação ativa. Ritmo de conversa fácil o tempo todo.'
};

function RD_gerarRun(p){
  if(!p.corrida)return {};

  const distMap={'5k':'5','10k':'10',meia:'21',maratona:'42'};
  const distKey=distMap[p.corrida]||'10';
  const nivelMap={destreinado:'ini',iniciante:'ini',intermediario:'int',avancado:'ava'};
  // Usa o NÍVEL DE CORRIDA especificamente informado (pode ser diferente do nível de musculação)
  const nivelParaPlano=p.nivelCorrida||p.nivel;
  const nivelKey=nivelMap[nivelParaPlano]||'int';
  const planoReal=RD_PLANOS_CORRIDA[nivelKey+distKey];
  if(!planoReal)return {};

  // Pace de referência (equivalente ao "pace de teste 3.200m")
  // Se o aluno informou o ritmo confortável real, usa ele (muito mais preciso).
  // Senão, estima pelo nível de corrida.
  let testPace;
  if(p.ritmoAtual){
    testPace=p.ritmoAtual*0.85; // ritmo confortável informado ≈ Z3 (85%) — reverte pra achar o testPace
  }else{
    const paceMap={destreinado:8.5,iniciante:7.5,intermediario:6.5,avancado:5.5};
    const paceBase=paceMap[nivelParaPlano]||7.0;
    testPace=paceBase*0.85;
  }

  // Zonas de FC (Karvonen) — complementam as zonas de ritmo do Rennan com referência de frequência cardíaca
  const fc=p.fcMax;
  const fcRep=p.nivel==='avancado'?55:p.nivel==='intermediario'?62:70;
  const res=fc-fcRep;
  const zHR=(lo,hi)=>`${Math.round(fcRep+res*lo)}-${Math.round(fcRep+res*hi)}bpm`;
  const ZONA_HR={Z1:zHR(.50,.60),Z2:zHR(.60,.70),Z3:zHR(.70,.80),Z4:zHR(.80,.90),Z5:zHR(.90,1.0)};

  const semanasOrdenadas=Object.keys(planoReal).map(Number).sort((a,b)=>a-b);
  const totalSemanas=semanasOrdenadas.length;
  const run={};

  semanasOrdenadas.forEach((wn)=>{
    const sessoesReais=planoReal[String(wn)];
    const sessions=sessoesReais.map(sr=>{
      const m=RD_montarSessao(sr.codigo,RD_DIA_ABREV[sr.dia]||sr.dia,testPace);
      if(!m)return null;
      // segmento "principal" = o de maior duração entre os que não são aquecimento/desaceleração
      const principais=m.segmentos.filter(s=>!['Aquecimento','Desaceleração'].includes(s.label));
      const dominante=principais.reduce((a,s)=>(!a||s.min>a.min)?s:a,null)||m.segmentos[0];
      const zonaDom=dominante?.zona||'Z2';
      return {
        day:m.dia,
        type:RD_TIPO_TITULO[m.tipo]||m.tipo,
        dist:m.distKm>0?m.distKm+' km':(m.durMin+' min'),
        distKm:m.distKm,
        pace:dominante?RD_fmtPace(testPace/RD_ZONA_PCT[zonaDom]):'—',
        fc:zonaDom+' '+ZONA_HR[zonaDom],
        dur:'~'+m.durMin+' min',
        blocos:m.blocos,
        segmentos:m.segmentos,
        tip:RD_TIPO_DICA[m.tipo]||'Respeite o ritmo indicado — a evolução vem da constância.'
      };
    }).filter(Boolean);

    // Volume total da semana (soma real de todas as sessões, em km)
    const volumeSemana=Math.round(sessions.reduce((a,s)=>a+s.distKm,0)*10)/10;
    const tiposDaSemana=[...new Set(sessions.map(s=>s.type))];

    const ehUltima=wn===semanasOrdenadas[semanasOrdenadas.length-1];
    const sessaoDestaque=sessions.reduce((a,s)=>(!a||s.distKm>a.distKm)?s:a,null);
    const metaTxt=ehUltima
      ?`🏁 Semana da PROVA — ${sessaoDestaque?sessaoDestaque.dist:distKey+'km'}! O grande dia chegou`
      :`${volumeSemana}km na semana · ${tiposDaSemana.join(' + ')}`;

    run['Semana '+wn]={meta:metaTxt,sessions,volumeSemana};
  });

  return run;
}
// ─── 7. FUNÇÃO PÚBLICA — substitui o fallback antigo ───
// tipo: 'gym' | 'run' | undefined (undefined = ambos, mantido por compatibilidade)
// ══ RUN ══
// ══ LIBERAÇÃO SEMANAL DO PLANO DE CORRIDA (por tempo) ══
// Periodização só funciona com tempo real de recuperação entre as semanas.
// Sem isso, o aluno completaria os 3 treinos da semana no mesmo dia e
// destravaria o plano inteiro em poucos dias — o que anula o efeito do treino.
function runSemanaLiberada(u){
  if(!u) return 1;
  if(!u.runInicio) return 1; // plano recém-criado: só a semana 1
  const dias = Math.floor((Date.now() - new Date(u.runInicio).getTime())/(1000*60*60*24));
  const porTempo = Math.floor(dias/7) + 1;
  const R = (typeof getRP==='function') ? getRP(u) : {};
  const total = Object.keys(R).length || 1;
  return Math.max(1, Math.min(porTempo, total));
}

// Quantos dias faltam pra próxima semana liberar (0 = já liberou)
function runDiasProxSemana(u){
  if(!u||!u.runInicio) return 7;
  const dias = Math.floor((Date.now() - new Date(u.runInicio).getTime())/(1000*60*60*24));
  return 7 - (dias % 7);
}

function renderRun(u){
  const R=getRP(u);const wks=Object.keys(R);const cw=`Semana ${u.runWeek||1}`;const prog=R[cw]||R[wks[0]]||{meta:'',sessions:[]};
  if(!u.trainApproved){document.getElementById('run-sessions').innerHTML=`<div style="text-align:center;padding:40px 20px"><div style="font-size:48px;margin-bottom:12px">⏳</div><div style="font-size:16px;font-weight:800;margin-bottom:8px">Programa de corrida em preparação</div><div style="font-size:13px;color:var(--t2)">Rennan está elaborando seu plano de corrida personalizado!</div></div>`;return;}
  document.getElementById('run-tag').textContent='🏃 CORRIDA';
  document.getElementById('run-title').textContent=`${cw} — ${prog.meta}`;
  document.getElementById('run-sub').textContent=`Semana ${u.runWeek||1} de ${wks.length}`;
  document.getElementById('run-prog').style.width=Math.round(((u.runWeek||1)/wks.length)*100)+'%';
  const liberadaAte=runSemanaLiberada(u);
  document.getElementById('run-wtabs').innerHTML=wks.map(w=>{const wn=parseInt(w.split(' ')[1]);const lk=wn>liberadaAte;const dn=wn<(u.runWeek||1);return `<div class="wk-week-btn ${w===cw?'active':''}" onclick="${lk?'':'selRW(\''+w+'\')' }" style="${lk?'opacity:.3;cursor:not-allowed':''}">${dn?'✅ ':lk?'🔒 ':''}${w}</div>`;}).join('');
  // Aviso de quando a próxima semana abre (só se ainda houver semana bloqueada)
  const elAviso=document.getElementById('run-unlock-info');
  if(elAviso){
    if(liberadaAte < wks.length){
      const d=runDiasProxSemana(u);
      elAviso.innerHTML=`<div style="background:rgba(255,255,255,.04);border:1px solid var(--b);border-radius:8px;padding:10px 12px;margin:0 20px 12px;font-size:11.5px;color:var(--t2);line-height:1.5">🔒 A <strong style="color:#fff">Semana ${liberadaAte+1}</strong> abre em ${d} ${d===1?'dia':'dias'} — a recuperação entre semanas faz parte do treino.</div>`;
    } else { elAviso.innerHTML=''; }
  }
  renderRunWeek(cw,u);
}
function selRW(w){const u=getU();if(!u)return;document.querySelectorAll('#run-wtabs .wk-week-btn').forEach(t=>t.classList.toggle('active',t.textContent.includes(w.replace('Semana ',''))));renderRunWeek(w,u);}
function renderRunWeek(w,u){
  const R=getRP(u);const prog=R[w];
  document.getElementById('run-sessions').innerHTML=prog.sessions.map((s,i)=>{
    const dk=`run_${w}_${i}`;const dn=u.runDone&&u.runDone[dk];
    const isGps=dn&&typeof dn==='object'&&dn.gps;
    const subTxt=isGps?`✅ ${dn.km}km em ${dn.dur} (${dn.pace}) 📍`:(dn?'✅ Concluída':'Pendente');
    return `<div class="rs-card ${dn?'done':''}"><div class="rs-hd"><div class="rs-ic">🏃</div><div><div class="rs-title">${s.day} — ${s.type}</div><div class="rs-sub">${subTxt}</div></div></div><div class="run-mets"><div class="rm"><div class="rm-l">Distância</div><div class="rm-v">${s.dist}</div></div><div class="rm"><div class="rm-l">Pace</div><div class="rm-v" style="font-size:10px">${s.pace}</div></div><div class="rm"><div class="rm-l">Duração</div><div class="rm-v">${s.dur}</div></div></div>${s.blocos&&s.blocos.length?`<div style="margin-bottom:12px">${s.blocos.map((b,bi)=>`<div style="padding:13px 14px;background:rgba(255,255,255,.03);border-left:3px solid ${bi===1?'var(--r)':'rgba(255,255,255,.14)'};border-radius:0 8px 8px 0;margin-bottom:6px;font-size:12.5px;font-weight:800;letter-spacing:.4px;line-height:1.45;color:${bi===1?'#fff':'var(--t2)'}">${b}</div>`).join('')}</div>`:''}<div class="run-tip">💡 ${s.tip}</div>${dn?`<button class="btn-run" style="background:rgba(46,204,113,.08);border:1px solid rgba(46,204,113,.2);color:#2ecc71" disabled>✅ Concluída!</button>`:`<button class="btn-run" style="background:rgba(229,9,20,.08);border:1px solid rgba(229,9,20,.15);color:var(--r)" onclick="markRun('${w}',${i})">▶ Marcar como feita</button><button class="btn-run-gps" onclick="startGPSRun('${w}',${i})">📍 Iniciar com GPS</button>`}</div>`;
  }).join('');
}
// completeRunSession: lógica única de conclusão de sessão de corrida, usada
// tanto pelo check manual (markRun) quanto pelo fluxo de GPS (saveGPSRun).
// extra=null → comportamento antigo (km prescrito, runDone[dk]=true).
// extra={km,dur,pace,coords,gps} → dados reais capturados por GPS.
function completeRunSession(w,i,extra){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return false;
  const R=getRP(u);const dk=`run_${w}_${i}`;if(!u.runDone)u.runDone={};if(u.runDone[dk])return false;
  const s=R[w].sessions[i];
  const km=(extra&&typeof extra.km==='number')?extra.km:parseFloat(s.dist);
  u.runDone[dk]=extra?{done:true,km:extra.km,dur:extra.dur,pace:extra.pace,coords:extra.coords,ts:Date.now(),gps:!!extra.gps}:true;
  if(!isNaN(km))u.stats.distancia=Math.round(((u.stats.distancia||0)+km)*10)/10;
  u.xp=(u.xp||0)+60;u.coins=(u.coins||0)+10;
  atualizarStreak(u);
  try{registrarEventoComunidade('treino',{nome:u.name,nome_treino:'Corrida ('+(isNaN(km)?'':km+'km')+(extra&&extra.gps?' 📍':'')+')',titulo:tituloAtual(u)?.emoji});}catch(e){}
  const tot=R[w].sessions.length;const tw=Object.keys(R).length;
  if([...Array(tot).keys()].every(j=>u.runDone[`run_${w}_${j}`])){
    const wn=parseInt(w.split(' ')[1]);
    // Só avança se o tempo também já liberou a próxima semana — completar
    // tudo no mesmo dia não deve destravar o plano inteiro.
    const liberada=runSemanaLiberada(u);
    if(wn===(u.runWeek||1)&&(u.runWeek||1)<tw&&liberada>(u.runWeek||1)){
      u.runWeek=(u.runWeek||1)+1;u.xp+=150;u.coins+=30;
    }else if(wn===(u.runWeek||1)&&liberada<=(u.runWeek||1)){
      const d=runDiasProxSemana(u);
      setTimeout(()=>fqToast(`✅ Semana concluída! A próxima abre em ${d} ${d===1?'dia':'dias'}.`,'ok',5000),300);
    }
  }
  if((u.xp||0)>=(u.level||1)*1000){u.level=(u.level||1)+1;u.xp=0;setTimeout(()=>fqToast('🎉 Subiu para o Nível '+(u.level||1)+'!','ok',5000),200);try{dispararConfete(40);}catch(e){}}
  DB.set('fq_users',users);
  syncU(u).catch(()=>{});
  return true;
}
function markRun(w,i){
  const ok=completeRunSession(w,i,null);
  if(!ok)return;
  const email=DB.get('fq_cur');
  loadApp(email);switchTab('run',document.querySelectorAll('.nbtn')[2]);
}

// ══ RASTREADOR DE CORRIDA POR GPS ══
let gpsWatchId=null,gpsTimerId=null,gpsCoords=[],gpsStartTs=null,gpsElapsedMs=0,gpsTotalKm=0,gpsLastPos=null,gpsTarget=null,gpsResult=null;

function startGPSRun(w,i){
  const u=getU();if(!u)return;
  const R=getRP(u);const s=R[w]&&R[w].sessions[i];
  gpsTarget={w,i,s};gpsCoords=[];gpsTotalKm=0;gpsElapsedMs=0;gpsLastPos=null;gpsResult=null;
  document.getElementById('grt-title').textContent=s?(s.day+' — '+s.type):'Corrida';
  document.getElementById('grt-permission').style.display='block';
  document.getElementById('grt-active').style.display='none';
  document.getElementById('grt-summary').style.display='none';
  document.getElementById('grt-error').style.display='none';
  document.getElementById('grt-poly').setAttribute('points','');
  document.getElementById('grt-time').textContent='00:00';
  document.getElementById('grt-km').textContent='0.00';
  document.getElementById('grt-pace').textContent='--:--';
  show('sc-run-tracker');
}

function requestGPSPermission(){
  if(!navigator.geolocation){showGPSError('Seu navegador não suporta localização.');return;}
  navigator.geolocation.getCurrentPosition(
    ()=>{document.getElementById('grt-permission').style.display='none';document.getElementById('grt-error').style.display='none';beginGPSTracking();},
    (err)=>{showGPSError(err.code===1?'Permissão de localização negada. Ative nas configurações do navegador pra esse site.':'Não conseguimos obter sua localização agora. Tente novamente em um local aberto.');},
    {enableHighAccuracy:true,timeout:15000}
  );
}

function showGPSError(msg){
  document.getElementById('grt-permission').style.display='none';
  document.getElementById('grt-active').style.display='none';
  document.getElementById('grt-error-msg').textContent=msg;
  document.getElementById('grt-error').style.display='block';
}

function beginGPSTracking(){
  document.getElementById('grt-active').style.display='block';
  const elTarget=document.getElementById('grt-target');
  if(gpsTarget&&gpsTarget.s){
    elTarget.innerHTML=`🎯 Meta desta sessão: <strong style="color:#fff">${gpsTarget.s.dist}</strong> em <strong style="color:#fff">${gpsTarget.s.pace}</strong>`;
  } else { elTarget.innerHTML=''; }
  gpsStartTs=Date.now()-gpsElapsedMs;
  gpsWatchId=navigator.geolocation.watchPosition(onGPSPosition,onGPSPositionError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  gpsTimerId=setInterval(updateGPSTimer,1000);
  document.getElementById('grt-btn-pause').textContent='⏸ Pausar';
}

function haversineKm(lat1,lon1,lat2,lon2){
  const R=6371;const dLat=(lat2-lat1)*Math.PI/180;const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function onGPSPosition(pos){
  const{latitude:lat,longitude:lng,accuracy}=pos.coords;
  if(accuracy&&accuracy>35)return; // fix impreciso demais, ignora
  if(gpsLastPos){
    const seg=haversineKm(gpsLastPos.lat,gpsLastPos.lng,lat,lng);
    if(seg<0.003)return; // ruído de GPS parado (<3m)
    if(seg>0.3){gpsLastPos={lat,lng};return;} // salto/erro de GPS (>300m de uma vez)
    gpsTotalKm+=seg;
  }
  gpsLastPos={lat,lng};
  gpsCoords.push({lat,lng,t:Date.now()});
  updateGPSStats();drawGPSRoute();
}

function onGPSPositionError(err){console.warn('GPS:',err.message);}

function updateGPSTimer(){
  gpsElapsedMs=Date.now()-gpsStartTs;
  const totalSec=Math.floor(gpsElapsedMs/1000);
  const mm=String(Math.floor(totalSec/60)).padStart(2,'0'),ss=String(totalSec%60).padStart(2,'0');
  document.getElementById('grt-time').textContent=mm+':'+ss;
  updateGPSStats();
}

function updateGPSStats(){
  document.getElementById('grt-km').textContent=gpsTotalKm.toFixed(2);
  const mins=gpsElapsedMs/60000;
  if(gpsTotalKm>0.05&&mins>0){
    const paceMin=mins/gpsTotalKm;const pm=Math.floor(paceMin),ps=String(Math.round((paceMin-pm)*60)).padStart(2,'0');
    document.getElementById('grt-pace').textContent=pm+':'+ps;
  }
}

function drawGPSRoute(){
  if(gpsCoords.length<2)return;
  const lats=gpsCoords.map(c=>c.lat),lngs=gpsCoords.map(c=>c.lng);
  const minLat=Math.min(...lats),maxLat=Math.max(...lats),minLng=Math.min(...lngs),maxLng=Math.max(...lngs);
  const w=280,h=180,pad=10;
  const spanLat=(maxLat-minLat)||0.0001,spanLng=(maxLng-minLng)||0.0001;
  const pts=gpsCoords.map(c=>{
    const x=pad+((c.lng-minLng)/spanLng)*w;
    const y=pad+(1-((c.lat-minLat)/spanLat))*h;
    return x.toFixed(1)+','+y.toFixed(1);
  }).join(' ');
  document.getElementById('grt-poly').setAttribute('points',pts);
}

function togglePauseGPSRun(){
  const btn=document.getElementById('grt-btn-pause');
  if(gpsWatchId!==null){
    navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;
    clearInterval(gpsTimerId);gpsTimerId=null;
    gpsLastPos=null; // evita contar o intervalo pausado como deslocamento ao retomar
    btn.textContent='▶ Retomar';
  } else {
    gpsStartTs=Date.now()-gpsElapsedMs;
    gpsWatchId=navigator.geolocation.watchPosition(onGPSPosition,onGPSPositionError,{enableHighAccuracy:true,maximumAge:0,timeout:15000});
    gpsTimerId=setInterval(updateGPSTimer,1000);
    btn.textContent='⏸ Pausar';
  }
}

function confirmFinishGPSRun(){
  if(gpsTotalKm<0.1){if(!confirm('Você registrou menos de 100m. Finalizar mesmo assim?'))return;}
  finishGPSRun();
}

function finishGPSRun(){
  if(gpsWatchId!==null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  if(gpsTimerId){clearInterval(gpsTimerId);gpsTimerId=null;}
  const totalSec=Math.floor(gpsElapsedMs/1000);
  const mm=String(Math.floor(totalSec/60)).padStart(2,'0'),ss=String(totalSec%60).padStart(2,'0');
  const mins=gpsElapsedMs/60000;
  let paceStr='--:--';
  if(gpsTotalKm>0.05&&mins>0){
    const paceMin=mins/gpsTotalKm;const pm=Math.floor(paceMin),ps=String(Math.round((paceMin-pm)*60)).padStart(2,'0');
    paceStr=pm+':'+ps;
  }
  gpsResult={km:Math.round(gpsTotalKm*100)/100,durSec:totalSec,durStr:mm+':'+ss,pace:paceStr+' min/km',coords:gpsCoords,ts:Date.now()};
  document.getElementById('grt-active').style.display='none';
  document.getElementById('grt-sum-km').textContent=gpsResult.km+' km';
  document.getElementById('grt-sum-time').textContent=gpsResult.durStr;
  document.getElementById('grt-sum-pace').textContent=gpsResult.pace;
  const cmp=document.getElementById('grt-sum-compare');
  cmp.innerHTML=(gpsTarget&&gpsTarget.s)?`🎯 Meta era <strong style="color:#fff">${gpsTarget.s.dist}</strong> em <strong style="color:#fff">${gpsTarget.s.pace}</strong>. Você fez <strong style="color:#fff">${gpsResult.km}km</strong> a <strong style="color:#fff">${gpsResult.pace}</strong>.`:'';
  document.getElementById('grt-summary').style.display='block';
}

function saveGPSRun(){
  if(!gpsResult)return;
  if(gpsTarget&&gpsTarget.w!=null&&gpsTarget.i!=null){
    completeRunSession(gpsTarget.w,gpsTarget.i,{km:gpsResult.km,dur:gpsResult.durStr,pace:gpsResult.pace,coords:gpsResult.coords,gps:true});
  }
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];
  if(u){
    if(!u.runLogs)u.runLogs=[];
    u.runLogs.push({km:gpsResult.km,durSec:gpsResult.durSec,pace:gpsResult.pace,ts:gpsResult.ts,coords:gpsResult.coords});
    DB.set('fq_users',users);syncU(u).catch(()=>{});
  }
  fqToast('✅ Corrida salva!','ok');
  const em2=DB.get('fq_cur');loadApp(em2);
  exitGPSRunToApp();
}

function discardGPSRun(){
  if(!confirm('Descartar esta corrida? Os dados não serão salvos.'))return;
  exitGPSRunToApp();
}

function exitGPSRun(){
  if(gpsWatchId!==null||gpsTimerId!==null){
    if(!confirm('Você tem uma corrida em andamento. Sair agora vai descartar o progresso. Tem certeza?'))return;
  }
  if(gpsWatchId!==null){navigator.geolocation.clearWatch(gpsWatchId);gpsWatchId=null;}
  if(gpsTimerId){clearInterval(gpsTimerId);gpsTimerId=null;}
  exitGPSRunToApp();
}

function exitGPSRunToApp(){
  show('sc-app');
  switchTab('run',document.querySelectorAll('.nbtn')[2]);
}

function markRunManualFallback(){
  if(gpsTarget&&gpsTarget.w!=null&&gpsTarget.i!=null)markRun(gpsTarget.w,gpsTarget.i);
  else exitGPSRunToApp();
}


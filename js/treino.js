// ═══════════════════════════════════════════════════════════
// FITQUEST — treino.js
// Motor de geração de treino de musculação, banco de
// exercícios, PRs, notificações, timer de descanso.
// ═══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// MOTOR RENNAN DIAS v1 — Sistema especialista de prescrição
// Divisão adaptativa por nível · Periodização ondulatória
// Deload condicional · Contraindicações por lesão
// ══════════════════════════════════════════════════════════════

// ─── 1. PERFIL DO ALUNO (interpreta a anamnese) ───
// Hash estável e simples (djb2) — mesmo texto sempre gera o mesmo número,
// textos diferentes geram números bem espalhados. Usado pra dar a cada
// aluno uma "assinatura" própria na escolha de exercícios, sem precisar
// guardar nada extra no banco — o próprio e-mail já é suficiente.
function RD_hashSemente(texto){
  let h=5381;
  const s=String(texto||'semente-padrao');
  for(let i=0;i<s.length;i++){ h=((h*33)^s.charCodeAt(i))>>>0; }
  return h;
}

function RD_perfil(an,semente){
  const t=(an.tempo||'').toLowerCase();
  let nivel='iniciante';
  if(t.includes('nunca'))nivel='destreinado';
  else if(t.includes('iniciante'))nivel='iniciante';
  else if(t.includes('intermedi'))nivel='intermediario';
  else if(t.includes('avan'))nivel='avancado';

  const dias=parseInt((an.dias||'3x').replace(/\D/g,''))||3;
  const dur=parseInt((an.dur||'60').replace(/\D/g,''))||60;

  const objs=(an.obj||[]).join(' ').toLowerCase();
  let objetivo='saude';
  if(/hipertrofia|massa/.test(objs))objetivo='hipertrofia';
  else if(/emagre|gordura|perder/.test(objs))objetivo='emagrecimento';
  else if(/for[çc]a/.test(objs))objetivo='forca';
  else if(/funcional|mobilidade|postura/.test(objs))objetivo='funcional';
  else if(/resist|condicion/.test(objs))objetivo='resistencia';

  // Idade e FC máxima (Tanaka: 208 - 0.7 × idade)
  let idade=30;
  if(an.nasc){const y=new Date(an.nasc).getFullYear();if(y>1900)idade=new Date().getFullYear()-y;}
  const fcMax=Math.round(208-0.7*idade);

  // Recuperação: sono, estresse e idade limitam volume
  let recup=1.0;
  const sono=(an.sono||'').toLowerCase();
  if(/menos de 5|4h|5h/.test(sono))recup-=0.20;
  else if(/5 a 6|6h/.test(sono))recup-=0.10;
  const stress=(an.stress||'').toLowerCase();
  if(/alto|muito/.test(stress))recup-=0.15;
  if(idade>=55)recup-=0.15;else if(idade>=45)recup-=0.08;
  recup=Math.max(0.55,Math.min(1.0,recup));

  // Ambiente de treino
  const local=(an.local||'').toLowerCase();
  let ambiente='completa';
  if(/b[áa]sica/.test(local))ambiente='basica';
  else if(/casa com/.test(local))ambiente='casa_equip';
  else if(/casa sem/.test(local))ambiente='casa_livre';
  else if(/rua|pista/.test(local))ambiente='rua';

  // Corrida
  const mc=(an.mc||[]).join(' ');
  let corrida=null;
  if(!/Não pratico/i.test(mc)){
    if(/42|Maratona(?! \(21)/i.test(mc))corrida='maratona';
    else if(/21|Meia/i.test(mc))corrida='meia';
    else if(/10 ?km/i.test(mc))corrida='10k';
    else if(/5 ?km/i.test(mc))corrida='5k';
    else if(/pace|velocidade/i.test(mc))corrida='pace';
  }

  // Prioridades musculares (o que o aluno quer focar)
  const foco=(an.foco||[]).map(f=>f.toLowerCase());

  // Nível de corrida — pode ser diferente do nível de musculação (aluno avançado na
  // academia pode ser iniciante correndo, ou vice-versa). Cai no nível geral se não respondido.
  const tc=(an.nivelCorrida||'').toLowerCase();
  let nivelCorrida=nivel; // fallback: usa o nivel geral se o aluno nao respondeu
  if(tc.includes('iniciante'))nivelCorrida='iniciante';
  else if(tc.includes('intermedi'))nivelCorrida='intermediario';
  else if(tc.includes('avan'))nivelCorrida='avancado';
  else if(tc.includes('não corro')||tc.includes('nao corro'))nivelCorrida=null;

  // Ritmo atual real de corrida (min/km), se o aluno informou — substitui a estimativa por nível
  let ritmoAtual=null;
  if(an.ritmoAtual){
    const m=String(an.ritmoAtual).match(/(\d+)[:\.](\d+)/);
    if(m)ritmoAtual=parseInt(m[1])+parseInt(m[2])/60;
    else{const m2=String(an.ritmoAtual).match(/(\d+(?:[.,]\d+)?)/);if(m2)ritmoAtual=parseFloat(m2[1].replace(',','.'));}
  }

  // Cargas de referência (kg) — usadas pra sugerir peso real em vez de só %1RM
  const cargaSupino=parseFloat(an.cargaSupino)||null;
  const cargaAgacho=parseFloat(an.cargaAgacho)||null;

  // Exercícios que o aluno prefere evitar (por preferência, não por lesão)
  const evitar=(an.evitar||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);

  return {nivel,dias,dur,objetivo,idade,fcMax,recup,ambiente,corrida,foco,
    nivelCorrida,ritmoAtual,cargaSupino,cargaAgacho,evitar,
    seed:RD_hashSemente(semente),
    lesoes:{joelho:!!an.temJoelho,lombar:!!an.temLombar,ombro:!!an.temOmbro},
    peso:parseFloat(an.peso)||75};
}

// ─── 2. DIVISÃO INTELIGENTE (nível decide, não só os dias) ───
function RD_divisao(p){
  const {nivel,dias,objetivo}=p;
  // Objetivo funcional/mobilidade: divisão própria
  if(objetivo==='funcional'){
    if(dias<=2)return ['FuncA','FuncC'].slice(0,dias);
    if(dias===3)return ['FuncA','FuncB','FuncC'];
    if(dias===4)return ['FuncA','FuncB','FuncC','HIIT'];
    return ['FuncA','FuncB','FuncC','HIIT','FullA'].slice(0,dias);
  }
  // Emagrecimento com 4+ dias: injeta 1 dia de HIIT
  if(objetivo==='emagrecimento'&&dias>=4&&nivel!=='destreinado'){
    const base=nivel==='avancado'?['Push','Pull','Legs']:['UpperA','LowerA','UpperB'];
    return dias===4?[...base,'HIIT']:[...base,'LowerB','HIIT'].slice(0,dias);
  }
  // Destreinado/iniciante: frequência alta por músculo, exercícios básicos
  if(nivel==='destreinado'||nivel==='iniciante'){
    if(dias<=2)return ['FullA','FullB'].slice(0,dias);
    if(dias===3)return ['FullA','FullB','FullC'];
    if(dias===4)return ['UpperA','LowerA','UpperB','LowerB'];
    return ['UpperA','LowerA','UpperB','LowerB','FullA'].slice(0,dias);
  }
  // Intermediário: Upper/Lower ou PPL
  if(nivel==='intermediario'){
    if(dias<=2)return ['UpperA','LowerA'].slice(0,dias);
    if(dias===3)return ['Push','Pull','Legs'];
    if(dias===4)return ['UpperA','LowerA','UpperB','LowerB'];
    if(dias===5)return ['Push','Pull','Legs','UpperA','LowerA'];
    return ['Push','Pull','Legs','UpperA','LowerA','FullA']; // 6d sem duplicar chaves
  }
  // Avançado: PPL 2x ou split por grupo
  if(dias<=3)return ['Push','Pull','Legs'].slice(0,dias);
  if(dias===4)return ['Peito+Triceps','Costas+Biceps','Pernas','Ombro+Core'];
  if(dias===5)return ['Peito+Triceps','Costas+Biceps','Pernas','Ombro+Core','PosteriorPant'];
  return ['Push','Pull','Legs','Peito+Triceps','Costas+Biceps','Pernas']; // 6d: sem chaves repetidas
}

// Nome legível de cada dia
const RD_NOMES={
  FuncA:'Funcional A — Corpo Todo + Core',FuncB:'Funcional B — Potência + Condicionamento',
  FuncC:'Funcional C — Cadeia Posterior + Mobilidade',HIIT:'HIIT — Condicionamento Metabólico',
  FullA:'Full Body A — Corpo Todo',FullB:'Full Body B — Corpo Todo',FullC:'Full Body C — Corpo Todo',
  UpperA:'Upper A — Peito/Costas/Braços',LowerA:'Lower A — Quadríceps/Panturrilha',
  UpperB:'Upper B — Ombro/Costas/Braços',LowerB:'Lower B — Posterior/Glúteo',
  Push:'Push — Peito/Ombro/Tríceps',Pull:'Pull — Costas/Bíceps',Legs:'Legs — Pernas Completo',
  'Peito+Triceps':'Peito + Tríceps','Costas+Biceps':'Costas + Bíceps',Pernas:'Pernas — Quadríceps/Glúteo',
  'Ombro+Core':'Ombro + Core',PosteriorPant:'Posterior + Panturrilha'
};

// Grupos musculares por tipo de treino (com nº de exercícios)
const RD_ESTRUTURA={
  FuncA:[['Corpo Todo',2],['Core',2],['Glúteo',1],['Ombro',1]],
  FuncB:[['Quadríceps',1],['Costas',1],['Core',2],['Pliometria',1],['Cardio',1]],
  FuncC:[['Posterior',1],['Peito',1],['Core',1],['Mobilidade',2]],
  HIIT:[['Cardio',3],['Corpo Todo',2],['Core',1]],
  FullA:[['Peito',1],['Costas',1],['Quadríceps',1],['Ombro',1],['Core',1]],
  FullB:[['Costas',1],['Peito',1],['Posterior',1],['Glúteo',1],['Core',1]],
  FullC:[['Quadríceps',1],['Peito',1],['Costas',1],['Bíceps',1],['Tríceps',1]],
  UpperA:[['Peito',2],['Costas',2],['Bíceps',1],['Tríceps',1]],
  LowerA:[['Quadríceps',2],['Glúteo',1],['Panturrilha',1],['Core',1]],
  UpperB:[['Ombro',2],['Costas',2],['Tríceps',1],['Bíceps',1]],
  LowerB:[['Posterior',2],['Glúteo',2],['Panturrilha',1],['Core',1]],
  Push:[['Peito',3],['Ombro',2],['Tríceps',2]],
  Pull:[['Costas',3],['Ombro Posterior',1],['Bíceps',2]],
  Legs:[['Quadríceps',2],['Posterior',2],['Glúteo',1],['Panturrilha',1]],
  'Peito+Triceps':[['Peito',4],['Tríceps',3]],
  'Costas+Biceps':[['Costas',4],['Bíceps',3]],
  Pernas:[['Quadríceps',3],['Glúteo',2],['Panturrilha',2]],
  'Ombro+Core':[['Ombro',3],['Ombro Posterior',1],['Core',3]],
  PosteriorPant:[['Posterior',3],['Glúteo',2],['Panturrilha',2]]
};

// ─── 3. SELEÇÃO DE EXERCÍCIOS (lesões + ambiente + variação) ───
const RD_CONTRA={
  // ── JOELHO ── bloqueia carga em flexão profunda, impacto e unilateral extremo.
  // Libera: flexora, glúteo (hip thrust/ponte), abdutora, panturrilha, core.
  joelho:/agachamento|squat|leg ?press|extensora|extensão de perna|avanço|passada|afundo|lunge|búlgaro|bulgaro|sissy|step.?up|subida no banco|hack|salto|jump|pliom|box|skater|pistol|burpee|thruster|wall ball|cossack|corrida|sprint|escada|stair|corda|skipping|polichinelo|mountain climber|wall sit|bear crawl|crab walk|man maker|devil press|clean|snatch|agachamento na parede/i,

  // ── LOMBAR ── bloqueia carga axial, flexão/extensão de coluna sob carga e balísticos.
  // Libera: máquinas com apoio de tronco, isolados sentado/deitado, glúteo em ponte.
  lombar:/terra|deadlift|stiff|good ?morning|bom dia|remada curvada|remada cavalinho|remada t\b|t-?bar|remada unilateral|landmine|agachamento livre|agachamento frontal|front squat|extensão lombar|hiperextens|superman|swing|snatch|clean|turkish|slam ball|wall ball|thruster|windshield|toes to bar|hanging|elevação de pernas na barra|roda abdominal|ab ?wheel|rollout|man maker|devil press|burpee|bear crawl|farmer|agachamento búlgaro|sled/i,

  // ── OMBRO ── bloqueia empurrar/puxar acima da cabeça, prensa horizontal e abertura profunda.
  // Libera de propósito: rotação externa, face pull, Y-T-W, escápula, alongamento e
  // foam roller — são exercícios de REABILITAÇÃO de ombro, não de risco.
  ombro:/supino|bench ?press|crucifixo|voador|peck ?deck|fly\b|crossover|pullover|desenvolvimento|military|arnold|overhead|acima da cabeça|elevação lateral|elevação frontal|remada alta|upright|dips|paralelas|mergulho|barra fixa|pull-?up|chin-?up|australiana|puxada|pulldown|flexão|push-?up|snatch|clean|thruster|wall ball|slam ball|man maker|devil press|burpee|landmine press|turkish|battle rope|corda naval|l-?sit|toes to bar|hanging|bear crawl|crab walk|handstand|pino|remada alta/i
};
const RD_EQUIP={
  completa:null, // tudo liberado
  basica:/halteres|barra|banco|peso corporal|livre|el[áa]stico|m[áa]quina/i,
  casa_equip:/halteres|peso corporal|el[áa]stico|banco|livre|kettlebell/i,
  casa_livre:/peso corporal|livre|el[áa]stico/i,
  rua:/peso corporal|livre/i
};

function RD_pool(grupo,p){
  const contra=[];
  if(p.lesoes.joelho)contra.push(RD_CONTRA.joelho);
  if(p.lesoes.lombar)contra.push(RD_CONTRA.lombar);
  if(p.lesoes.ombro)contra.push(RD_CONTRA.ombro);
  const eq=RD_EQUIP[p.ambiente];
  const g=grupo.toLowerCase();
  const evitar=p.evitar||[];
  let filtrado=EXERCISE_BANK.filter(e=>{
    if(!e.muscle)return false;
    if(!e.muscle.toLowerCase().includes(g))return false;
    if(contra.some(rx=>rx.test(e.name)))return false;      // lesão contraindica
    if(eq&&!eq.test(e.equipment||''))return false;          // equipamento indisponível
    return true;
  });
  // Preferência do aluno (não é contraindicação de segurança — se filtrar tudo, ignora a preferência
  // pra não deixar o grupo muscular sem nenhum exercício disponível)
  if(evitar.length){
    const semEvitados=filtrado.filter(e=>!evitar.some(termo=>e.name.toLowerCase().includes(termo)));
    if(semEvitados.length)filtrado=semEvitados;
  }
  return filtrado;
}

// Rotação por semana: varia exercícios (evita adaptação e monotonia)
function RD_escolhe(grupo,n,p,semana,excluir,ancora){
  let pool=RD_pool(grupo,p);
  // Fallback 1: relaxa o grupo, MAS mantém equipamento e lesões (nunca prescreve o que o aluno não pode fazer)
  if(!pool.length){
    const eq=RD_EQUIP[p.ambiente];
    const contra=[];
    if(p.lesoes.joelho)contra.push(RD_CONTRA.joelho);
    if(p.lesoes.lombar)contra.push(RD_CONTRA.lombar);
    if(p.lesoes.ombro)contra.push(RD_CONTRA.ombro);
    pool=EXERCISE_BANK.filter(e=>{
      if(eq&&!eq.test(e.equipment||''))return false;
      if(contra.some(rx=>rx.test(e.name)))return false;
      return true;
    });
  }
  if(!pool.length)return [];
  const out=[];
  const usados=new Set(excluir||[]);
  // ÂNCORA: o exercício principal (composto) NÃO rotaciona AO LONGO DAS SEMANAS do mesmo
  // aluno — especificidade gera força (Kassiano 2022). Evidência: variar vs. manter exercícios
  // dá hipertrofia SIMILAR, mas força exige repetir o movimento.
  // Porém ENTRE alunos diferentes, a escolha varia pela "assinatura" de cada um (p.seed) — sem
  // isso, todo aluno com perfil parecido (mesmo nível/equipamento) cairia sempre na mesma opção.
  if(ancora){
    const candidatosAncora=pool.filter(e=>/supino|agachamento|hack squat|terra|remada curvada|remada t\b|cavalinho|remada baixa|desenvolvimento|puxada|barra fixa|leg press|stiff|thruster|burpee|clean|snatch|devil press|man maker|turkish get|wall ball|sled push/i.test(e.name)&&!/pausa|isometr|wall sit/i.test(e.name)&&!usados.has(e.id));
    if(candidatosAncora.length){
      const idx=(p&&p.seed?p.seed:0)%candidatosAncora.length;
      const comp=candidatosAncora[idx];
      usados.add(comp.id);out.push(comp);
    }
  }
  // ACESSÓRIOS: rotacionam a cada 2 semanas (variedade sustenta adesão e cobre ângulos diferentes),
  // e cada aluno começa esse giro num ponto diferente (mesma logica da assinatura acima)
  const semOffset=(p&&p.seed?p.seed:0)%Math.max(1,pool.length);
  const off=(Math.floor((semana-1)/2)+semOffset)%Math.max(1,pool.length);
  for(let i=0;i<pool.length&&out.length<n;i++){
    const e=pool[(off+i)%pool.length];
    if(usados.has(e.id))continue;
    usados.add(e.id);out.push(e);
  }
  return out;
}

// ─── 4. PERIODIZAÇÃO ONDULATÓRIA + DELOAD CONDICIONAL ───
function RD_deloadSemanas(p){
  // Avançado e intermediário: deload nas semanas 4 e 8
  if(p.nivel==='avancado')return [4,8];
  if(p.nivel==='intermediario')return [8];
  // Iniciante/destreinado: sem deload (o volume já é baixo)
  return [];
}

function RD_prescricao(p,semana,ehDeload){
  // Ondulatória: cada bloco de 2 semanas oscila volume × intensidade
  const bloco=Math.ceil(semana/2); // 1..4
  const O=p.objetivo;
  let sets,reps,rir,rest,fase,carga;

  if(ehDeload){
    return {sets:2,reps:'12',rir:'4-5',rest:60,carga:'Leve (50-60% do habitual)',
      fase:'⚡ DELOAD — Recuperação Ativa (volume -40%, carga -30%)'};
  }

  if(O==='hipertrofia'){
    // Evidência: hipertrofia melhora conforme a série se aproxima da falha (Refalo 2022/2025).
    // 1-2 RIR entrega hipertrofia equivalente à falha com MENOS desprazer → melhor adesão.
    const tab=[
      {sets:3,reps:'12-15',rir:'2-3',rest:75,carga:'Moderada (60-70% 1RM)',fase:'Acumulação — Volume e Técnica'},
      {sets:4,reps:'8-12',rir:'1-2',rest:90,carga:'Moderada-Alta (70-80% 1RM)',fase:'Intensificação — Sobrecarga Progressiva'},
      {sets:4,reps:'6-10',rir:'1',rest:105,carga:'Alta (75-85% 1RM)',fase:'Realização — Perto da Falha'},
      {sets:5,reps:'8-12',rir:'0-1',rest:90,carga:'Alta (75-85% 1RM)',fase:'Pico — Máximo Estímulo'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }else if(O==='forca'){
    // Evidência: ganhos de FORÇA são similares numa faixa ampla de RIR — treinar até a falha
    // NÃO é necessário e atrapalha a recuperação neural. Carga alta + RIR 2-4.
    const tab=[
      {sets:4,reps:'6',rir:'3-4',rest:150,carga:'Moderada (70-75% 1RM)',fase:'Base de Força — Padrões Motores'},
      {sets:5,reps:'5',rir:'2-3',rest:180,carga:'Alta (80-85% 1RM)',fase:'Força Máxima — Neural'},
      {sets:5,reps:'3',rir:'2',rest:210,carga:'Muito Alta (85-92% 1RM)',fase:'Pico Neural — Cargas Altas'},
      {sets:4,reps:'5',rir:'2-3',rest:180,carga:'Alta (82-88% 1RM)',fase:'Consolidação de Força'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }else if(O==='emagrecimento'){
    const tab=[
      {sets:3,reps:'15',rir:'2-3',rest:45,carga:'Moderada (55-65% 1RM)',fase:'Metabólico — Densidade Alta'},
      {sets:4,reps:'12-15',rir:'1-2',rest:40,carga:'Moderada (60-70% 1RM)',fase:'Circuito Metabólico — Queima'},
      {sets:4,reps:'10-12',rir:'1-2',rest:45,carga:'Moderada-Alta (65-75% 1RM)',fase:'Força + Metabólico'},
      {sets:4,reps:'12-15',rir:'1',rest:40,carga:'Moderada (60-70% 1RM)',fase:'Pico Metabólico'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }else if(O==='resistencia'){
    const tab=[
      {sets:3,reps:'15-20',rir:'3-4',rest:45,carga:'Leve-Moderada (50-60% 1RM)',fase:'Base de Resistência'},
      {sets:3,reps:'15-20',rir:'2-3',rest:40,carga:'Moderada (55-65% 1RM)',fase:'Resistência Muscular'},
      {sets:4,reps:'20',rir:'2',rest:35,carga:'Moderada (55-65% 1RM)',fase:'Resistência Avançada'},
      {sets:4,reps:'15-20',rir:'2',rest:40,carga:'Moderada (60-70% 1RM)',fase:'Pico de Resistência'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }else if(O==='funcional'){
    const tab=[
      {sets:3,reps:'10-12',rir:'3',rest:60,carga:'Leve-Moderada — foco no padrão',fase:'Padrões Fundamentais'},
      {sets:3,reps:'8-12',rir:'2-3',rest:60,carga:'Moderada — controle total',fase:'Integração e Estabilidade'},
      {sets:4,reps:'6-10',rir:'2',rest:75,carga:'Moderada-Alta',fase:'Potência e Transferência'},
      {sets:3,reps:'8-12',rir:'2-3',rest:60,carga:'Moderada',fase:'Consolidação Funcional'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }else{ // saúde
    // Evidência (Radaelli 2025, 151 RCTs em idosos): volume MODERADO já entrega o benefício.
    const tab=[
      {sets:2,reps:'12-15',rir:'4',rest:60,carga:'Leve (50-60% 1RM)',fase:'Adaptação — Aprendendo o Movimento'},
      {sets:3,reps:'12',rir:'3',rest:60,carga:'Moderada (60-70% 1RM)',fase:'Condicionamento Geral'},
      {sets:3,reps:'10-12',rir:'2-3',rest:75,carga:'Moderada (60-70% 1RM)',fase:'Força Funcional'},
      {sets:3,reps:'12',rir:'3',rest:60,carga:'Moderada (60-70% 1RM)',fase:'Manutenção e Hábito'}
    ];
    ({sets,reps,rir,rest,carga,fase}=tab[bloco-1]||tab[0]);
  }

  // Ajuste por recuperação (sono ruim/estresse/idade reduzem volume)
  if(p.recup<0.75)sets=Math.max(2,sets-1);
  // Duração curta: corta 1 série
  if(p.dur<=30)sets=Math.max(2,sets-1);

  return {sets,reps,rir,rest,carga,fase};
}


// ─── BLOCOS COMPLEMENTARES: aquecimento, ativação e finalizador ───
const RD_AQUECIMENTO={
  // e240 (duplicata de e152 Cat-Cow) removido; e162 e e129 adicionados — mais variedade real
  geral:['e152','e144','e161','e162','e129'],                // gato-vaca, polichinelo, postura da criança, cachorro olhando p/ baixo, cossack
  // e239 (duplicata de e155 alongamento de flexor de quadril) removido; e159 adicionado
  lower:['e152','e163','e155','e154','e165','e160','e159'], // mobilidade, ativação glúteo, flexores, foam roller IT band
  upper:['e153','e169','e166','e156','e157','e158','e170'], // torácica, escápula, manguito (+ variações)
  corrida:['e160','e154','e163','e165','e159']             // panturrilha, quadril, glúteo (+ variações)
};
const RD_FINALIZADOR={
  // Cada lista inclui opções de peso corporal — o filtro de equipamento escolhe as viáveis
  emagrecimento:['e113','e143','e146','e145','e096','e097'], // rope, burpee box, corda, corrida alta, mountain, burpee
  resistencia:['e146','e149','e144','e145'],
  hipertrofia:['e133','e135','e137'],          // core estabilizador (peso corporal)
  forca:['e134','e171','e133'],                // pallof, farmer, prancha toque
  funcional:['e121','e137','e133','e134'],     // bear crawl, hollow, prancha, pallof
  saude:['e136','e135','e161']                 // bird dog, dead bug, criança
};
const RD_MOBILIDADE_FIM=['e161','e162','e157','e160'];

function RD_bloco(ids,p,tipo,semana,excluir){
  const byId=Object.fromEntries(EXERCISE_BANK.map(e=>[e.id,e]));
  const contra=[];
  if(p.lesoes.joelho)contra.push(RD_CONTRA.joelho);
  if(p.lesoes.lombar)contra.push(RD_CONTRA.lombar);
  if(p.lesoes.ombro)contra.push(RD_CONTRA.ombro);
  const eq=RD_EQUIP[p.ambiente];
  const usados=new Set(excluir||[]);
  return ids.map(id=>byId[id]).filter(e=>{
    if(!e)return false;
    if(usados.has(e.id))return false;                 // já está no treino
    if(contra.some(rx=>rx.test(e.name)))return false;
    if(eq&&!eq.test(e.equipment||''))return false;
    return true;
  }).map(e=>({
    id:e.id,
    sets:tipo==='aquec'?1:2,
    reps:tipo==='aquec'?'30-45s':(tipo==='final'?'40s':'30s'),
    load:tipo==='aquec'?'Sem carga — preparação':'Peso corporal / leve',
    rest:tipo==='aquec'?20:45,
    obs:(tipo==='aquec'?'🔥 AQUECIMENTO — ':(tipo==='final'?'💥 FINALIZADOR — ':'🧘 MOBILIDADE — '))+(e.obs||'')
  }));
}

// ─── 5. MOTOR PRINCIPAL — monta as 8 semanas ───

// ─── CONTROLE DE VOLUME SEMANAL (evidência: 12-20 séries/músculo/semana) ───
// Pelland et al. 2026 (Sports Med, 67 estudos): dose-resposta com retornos decrescentes acima de ~20 séries.
// Radaelli et al. 2025 (151 RCTs, idosos): volume moderado já entrega o benefício — mais não é melhor.
const RD_VOL_ALVO={
  hipertrofia:{min:12,max:20},   // zona ótima comprovada
  forca:{min:8,max:16},          // força responde a menos volume (intensidade manda)
  emagrecimento:{min:10,max:18},
  resistencia:{min:10,max:18},
  funcional:{min:8,max:14},
  saude:{min:6,max:12}           // dose mínima eficaz — adesão > volume
};

// Conta séries semanais por grupo muscular e corta o excesso
function RD_auditarVolume(gym,p){
  const alvo=RD_VOL_ALVO[p.objetivo]||RD_VOL_ALVO.saude;
  const byId=Object.fromEntries(EXERCISE_BANK.map(e=>[e.id,e]));
  const teto=Math.round(alvo.max*(p.recup||1)); // recuperação ruim reduz o teto
  Object.keys(gym).forEach(semKey=>{
    if(/DELOAD/.test(gym[semKey].fase||''))return; // deload não é auditado
    const contagem={};
    // 1ª passada: conta séries diretas por grupo (ignora aquecimento/mobilidade)
    Object.values(gym[semKey].days).forEach(exs=>exs.forEach(e=>{
      if(/AQUECIMENTO|MOBILIDADE/.test(e.obs||''))return;
      const ex=byId[e.id];if(!ex||!ex.muscle)return;
      const grupo=ex.muscle.split('/')[0].trim();
      contagem[grupo]=(contagem[grupo]||0)+e.sets;
    }));
    // 2ª passada: corta o excesso em 2 etapas (séries primeiro, depois exercícios inteiros)
    Object.entries(contagem).forEach(([grupo,total])=>{
      if(total<=teto)return;
      let excesso=total-teto;
      const ehDoGrupo=(e)=>{
        if(/AQUECIMENTO|MOBILIDADE|FINALIZADOR/.test(e.obs||''))return false;
        const ex=byId[e.id];
        return ex&&ex.muscle&&ex.muscle.split('/')[0].trim()===grupo;
      };
      const ehComposto=(e)=>{
        const ex=byId[e.id];
        return ex&&/supino|agachamento|terra|remada|desenvolvimento|puxada|barra fixa|leg press|stiff/i.test(ex.name);
      };
      // ETAPA A: reduzir séries dos acessórios até o piso de 2
      Object.values(gym[semKey].days).forEach(exs=>exs.forEach(e=>{
        if(excesso<=0||!ehDoGrupo(e)||ehComposto(e))return;
        while(excesso>0&&e.sets>2){e.sets--;excesso--;}
      }));
      // ETAPA B: ainda excedido? remover acessórios inteiros (do último para o primeiro)
      if(excesso>0){
        Object.keys(gym[semKey].days).forEach(dk=>{
          const exs=gym[semKey].days[dk];
          for(let i=exs.length-1;i>=0&&excesso>0;i--){
            const e=exs[i];
            if(!ehDoGrupo(e)||ehComposto(e))continue;
            // Não remove se for o único exercício do grupo naquele dia
            const doGrupoNoDia=exs.filter(ehDoGrupo).length;
            if(doGrupoNoDia<=1)continue;
            excesso-=e.sets;
            exs.splice(i,1);
          }
        });
      }
      // ETAPA C: último recurso — reduzir séries do composto (mantém no mínimo 3)
      if(excesso>0){
        Object.values(gym[semKey].days).forEach(exs=>exs.forEach(e=>{
          if(excesso<=0||!ehDoGrupo(e)||!ehComposto(e))return;
          while(excesso>0&&e.sets>3){e.sets--;excesso--;}
        }));
      }
    });
    // Recontar após os cortes (o número exibido precisa ser o real)
    const contagemFinal={};
    Object.values(gym[semKey].days).forEach(exs=>exs.forEach(e=>{
      if(/AQUECIMENTO|MOBILIDADE/.test(e.obs||''))return;
      const ex=byId[e.id];if(!ex||!ex.muscle)return;
      const grupo=ex.muscle.split('/')[0].trim();
      contagemFinal[grupo]=(contagemFinal[grupo]||0)+e.sets;
    }));
    gym[semKey].volumeSemanal=contagemFinal;
  });
  return gym;
}

// ══ TÉCNICAS DE INTENSIDADE (hipertrofia) ══
// Aplicadas só no último acessório do dia, só nas fases mais avançadas
// (bloco 2+ da periodização — nunca na Acumulação nem no Deload), e só
// em exercícios seguros pra levar à falha sem spotter (máquina/isolador —
// nunca em composto livre pesado, que já tem sua própria lógica).
const RD_TECNICAS = [
  {
    id: 'dropset',
    nome: 'Drop-set',
    obs: 'Técnica: DROP-SET — na última série, ao falhar, reduza 20-25% da carga e continue até nova falha, sem descanso.'
  },
  {
    id: 'restpause',
    nome: 'Rest-Pause',
    obs: 'Técnica: REST-PAUSE — na última série, ao falhar, pause 15s respirando fundo, e continue com a mesma carga até nova falha.'
  }
];

// Decide se um exercício é elegível pra levar técnica de intensidade
// (evita comprometer composto pesado, cardio, pliometria e isometria)
function RD_elegivelTecnica(nome){
  const nãoElegivel = /supino|agachamento|hack squat|terra|remada curvada|remada t\b|cavalinho|remada baixa|desenvolvimento|puxada|barra fixa|leg press|stiff|thruster|burpee|clean|snatch|devil press|man maker|salto|jump|pliom|box|skater|cardio|sprint|corda|rope|bike|remo|esteira|el[íi]ptico|escada|isometri|hold|wall sit|pausa|l-sit/i;
  return !nãoElegivel.test(nome);
}

function RD_gerarGym(p){
  const divisao=RD_divisao(p);
  const deloads=RD_deloadSemanas(p);
  const gym={};

  for(let s=1;s<=8;s++){
    const ehDeload=deloads.includes(s);
    const presc=RD_prescricao(p,s,ehDeload);
    const days={};

    divisao.forEach((tipo,di)=>{
      const estrutura=RD_ESTRUTURA[tipo]||RD_ESTRUTURA.FullA;
      const exs=[];

      // ── BLOCO 1: AQUECIMENTO ESPECÍFICO (sempre) ──
      const ehLower=/Lower|Legs|Pernas|Posterior/i.test(tipo);
      const ehUpper=/Upper|Push|Pull|Peito|Costas|Ombro/i.test(tipo);
      const aq=ehLower?RD_AQUECIMENTO.lower:(ehUpper?RD_AQUECIMENTO.upper:RD_AQUECIMENTO.geral);
      let blocoAqTodos=RD_bloco(aq,p,'aquec',s,[]);
      if(!blocoAqTodos.length)blocoAqTodos=RD_bloco(['e152','e161','e136'],p,'aquec',s,[]);
      // A "assinatura" do aluno (p.seed) decide POR ONDE começar a lista de aquecimento —
      // sem isso, todo aluno via sempre os mesmos 2-3 primeiros itens da lista fixa.
      const aqOffset=(p&&p.seed?p.seed:0)%Math.max(1,blocoAqTodos.length);
      const blocoAq=[];
      for(let k=0;k<blocoAqTodos.length&&blocoAq.length<3;k++){
        blocoAq.push(blocoAqTodos[(aqOffset+k)%blocoAqTodos.length]);
      }
      blocoAq.forEach(e=>exs.push(e));

      // ── BLOCO 2: TREINO PRINCIPAL ──
      const jaUsados=exs.map(x=>x.id); // evita repetir o que já entrou no aquecimento
      let ultimoAcessorioElegivel=null; // rastreia o alvo pra técnica de intensidade
      estrutura.forEach(([grupo,qtd],gi)=>{
        const temFoco=p.foco.some(f=>grupo.toLowerCase().includes(f)||f.includes(grupo.toLowerCase()));
        const n=temFoco&&!ehDeload?qtd+1:qtd;
        const ehAncora=gi===0; // 1º grupo do treino carrega o composto principal (não rotaciona)
        RD_escolhe(grupo,n,p,s+di,jaUsados,ehAncora).forEach((e)=>{
          jaUsados.push(e.id);
          const composto=/supino|agachamento|hack squat|terra|remada|desenvolvimento|puxada|barra fixa|leg press|stiff|thruster|burpee|clean|snatch|devil press|man maker/i.test(e.name);
          const pliom=/salto|jump|pliom|box|skater/i.test(e.name);
          const cardio=/cardio|sprint|corda|rope|bike|remo|esteira|el[íi]ptico|escada/i.test(e.name+' '+(e.muscle||''));
          const isometria=/isometri|hold|wall sit|pausa|l-sit/i.test(e.name);
          let sets=presc.sets,reps=presc.reps,rest=presc.rest,load=presc.carga;
          if(pliom){sets=Math.min(4,presc.sets);reps='6-8 (explosivo)';rest=presc.rest+30;load='Peso corporal — foco na potência';}
          else if(cardio){
            const ehDiaHIIT=/HIIT/i.test(tipo);
            sets=ehDiaHIIT?1:2;
            reps=ehDiaHIIT?'8 rounds (30s forte / 90s leve)':'40-60s (esforço alto)';
            rest=ehDiaHIIT?0:60;
            load=ehDiaHIIT?'Intensidade máxima nos 30s':'Ritmo forte e sustentável';
          }
          else if(isometria){reps='20-40s (segure)';rest=60;load='Sustentação máxima com técnica';}
          else if(composto)rest=presc.rest+15;
          // Se o aluno informou carga de referência (supino/agachamento), converte a faixa
          // de %1RM em kg reais e some ao lado do texto — muito mais acionável que só %
          const ehSupinoRef=/supino/i.test(e.name), ehAgachoRef=/agachamento/i.test(e.name);
          const refKg=ehSupinoRef?p.cargaSupino:(ehAgachoRef?p.cargaAgacho:null);
          if(refKg&&typeof load==='string'){
            const mPct=load.match(/(\d+)-(\d+)%/);
            if(mPct){
              const kgMin=Math.round(refKg*parseInt(mPct[1])/100);
              const kgMax=Math.round(refKg*parseInt(mPct[2])/100);
              load=load+` · ≈${kgMin}-${kgMax}kg`;
            }
          }
          const exObj={id:e.id,sets,reps,load,rest,obs:`RIR ${presc.rir} (deixe ${presc.rir} reps na reserva). ${e.obs||'Execute com controle total.'}`};
          exs.push(exObj);
          // Só considera acessório (não âncora) e só se for seguro pra levar à falha
          if(!ehAncora && !pliom && !cardio && !isometria && RD_elegivelTecnica(e.name)){
            ultimoAcessorioElegivel=exObj;
          }
        });
      });

      // ── TÉCNICA DE INTENSIDADE — só hipertrofia, fases avançadas, nunca no deload ──
      // (Evidência já usada no motor: ganhos de FORÇA não se beneficiam de treinar
      // até a falha — por isso essas técnicas ficam restritas ao objetivo hipertrofia.)
      const blocoAtual=Math.ceil(s/2); // mesmo cálculo usado dentro de RD_prescricao
      if(p.objetivo==='hipertrofia' && !ehDeload && blocoAtual>=2 && ultimoAcessorioElegivel){
        const tecnica=RD_TECNICAS[(s+di)%RD_TECNICAS.length]; // alterna pra variar entre semanas
        ultimoAcessorioElegivel.tecnica=tecnica.nome;
        ultimoAcessorioElegivel.tecnicaObs=tecnica.obs;
      }

      // ── BLOCO 3: FINALIZADOR METABÓLICO (não no deload) ──
      if(!ehDeload&&p.dur>=45){
        const fin=RD_FINALIZADOR[p.objetivo]||RD_FINALIZADOR.saude;
        const usados=exs.map(x=>x.id);
        const rot=[...fin.slice((s+di)%fin.length),...fin.slice(0,(s+di)%fin.length)];
        let bloco=RD_bloco(rot,p,'final',s,usados).slice(0,1);
        if(!bloco.length)bloco=RD_bloco(['e135','e136','e161','e137'],p,'final',s,usados).slice(0,1);
        bloco.forEach(e=>exs.push(e));
      }

      // ── BLOCO 4: MOBILIDADE FINAL (sempre — recuperação) ──
      const usadosM=exs.map(x=>x.id);
      const off=(s+di)%RD_MOBILIDADE_FIM.length;
      const mobRot=[...RD_MOBILIDADE_FIM.slice(off),...RD_MOBILIDADE_FIM.slice(0,off)];
      RD_bloco(mobRot,p,'mob',s,usadosM).slice(0,1).forEach(e=>exs.push(e));

      days[RD_NOMES[tipo]||tipo]=exs;
    });

    gym['Semana '+s]={fase:presc.fase,days};
  }
  return RD_auditarVolume(gym,p); // corta excesso de volume (evidência: >20 séries = retorno decrescente)
}

// ─── 6. MOTOR DE CORRIDA (zonas de FC reais + progressão) ───
const RD_TREINOS_DB={"CAM4":{"tipo":"CAMINHADA","aquecimento":"5 MIN CAMINHADA","principal":"4KM DE CAMINHADA EM Z1 (MUITO LEVE)","esfriamento":"5 MIN CAMINHADA"},"CAM40":{"tipo":"CAMINHADA","aquecimento":"NÃO","principal":"40 MINUTOS DE CAMINHADA EM Z1 (MUITO LEVE)","esfriamento":"NÃO"},"CAM45":{"tipo":"CAMINHADA","aquecimento":"NÃO","principal":"40 MINUTOS DE CAMINHADA EM Z1 (MUITO LEVE)","esfriamento":"NÃO"},"CAM5":{"tipo":"CAMINHADA","aquecimento":"5 MIN CAMINHADA","principal":"5KM DE CAMINHADA EM Z1 (MUITO LEVE)","esfriamento":"5 MIN CAMINHADA"},"CAM6":{"tipo":"CAMINHADA","aquecimento":"5 MIN CAMINHADA","principal":"5KM DE CAMINHADA EM Z1 (MUITO LEVE)","esfriamento":"5 MIN CAMINHADA"},"FAR10-1KMX1KM":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"10KM INTERCALANDO 1KM FORTE(Z4) X 1KM LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR10-400X400":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"10KM INTERCALANDO 400M FORTE(Z4) X 400M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR10-500X500":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"10KM INTERCALANDO 500M FORTE(Z4) X 500M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR10-600X400":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"10KM INTERCALANDO 600M FORTE(Z4) X 400M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR10-700X300":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"10KM INTERCALANDO 700M FORTE(Z4) X 300M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR12-1KMX1KM":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"12KM INTERCALANDO 1KM FORTE(Z4) X 1KM LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR12-2KMX1KM":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"12KM INTERCALANDO 2KM FORTE(Z4) X 1KM LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR12-3KMX3KM":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"12KM INTERCALANDO 3KM FORTE(Z4) X 3KM LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR12-500X500":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"12KM INTERCALANDO 500M FORTE(Z4) X 500M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR12-600X600":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"12KM INTERCALANDO 600M FORTE(Z4) X 600M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR6-300X300":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"6KM INTERCALANDO 300M FORTE(Z4) X 300M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR6-400X200":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"6KM INTERCALANDO 400M FORTE(Z4) X 200M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR6-400X400":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"6KM INTERCALANDO 400M FORTE(Z4) X 400M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR6-500X500":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"6KM INTERCALANDO 500M FORTE(Z4) X 500M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR6-600X600":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"6KM INTERCALANDO 600M FORTE(Z4) X 600M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR7KM-2'X2'":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"7KM INTERCALANDO 200M FORTE (Z4) X 200M LEVE (Z2)","esfriamento":"5 MIN TROTE"},"FAR8-400X400":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"8KM INTERCALANDO 400M FORTE(Z4) X 400M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR8-500X300":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"8KM INTERCALANDO 500M FORTE(Z4) X 300M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR8-500X500":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"8KM INTERCALANDO 500M FORTE(Z4) X 500M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR8-600X200":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"8KM INTERCALANDO 600M FORTE(Z4) X 200M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"FAR8-800X800":{"tipo":"FARTLEK","aquecimento":"5 MIN TROTE","principal":"8KM INTERCALANDO 800M FORTE(Z4) X 800M LEVE(Z2)","esfriamento":"5 MIN TROTE"},"INI35-1'X1'":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"35 MIN: 1' CORRIDA LEVE X 1' CAMINHANDO","esfriamento":"5 MIN CAMINHANDO"},"INI40-3'X1'":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"40 MINUTOS INTERCALANDO 3' CORRENDO X 1' CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI45-1'X1'":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"45 MINUTOS INTERCALANDO 1' CORRENDO UM POUCO MAIS FORTE X 1' CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI4KM-200X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"4KM INTERCALANDO 200M CORRENDO LEVE X 200 M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI4KM-300X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"4KM INTERCALANDO 300M CORRENDO X 200M CAMINHANDO","esfriamento":"5 MIN CAMINHANDO"},"INI50-4'X1'":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"50 MIN INTERCALANDO 4' CORRIDA X 1' CAMINHADA","esfriamento":"5 MIN CAMINHADA"},"INI5K-100X100|300X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"3KM - 100M CORRENDO x100M CAMINHANDO. 2 KM - 300M CORRENDO X 200M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI5K-700MX300M":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 700 M CORRENDO X 300M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI5KM-100FX100":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 100M FORTE X 100M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI5KM-2,5KMX4' PARADO":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"2,5KM CORRENDO + 4 ' PARADO + 2,5KM CORRENDO","esfriamento":"5 MIN CAMINHADA"},"INI5KM-400X100":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 400M CORRIDA X 100M CAMINHADA","esfriamento":"5 MIN CAMINHADA"},"INI5KM-4'X1'":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 4' CORRIDA X 1' CAMINHADA","esfriamento":"5 MIN CAMINHADA"},"INI5KM-800X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 800M CORRENDO X 200M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI5KM-900X100":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM INTERCALANDO 900M DE CORRIDA X 100M DE CAMINHADA","esfriamento":"5 MIN CAMINHADA"},"INI5KM-TESTE":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5KM CORRENDO, SEMPRE QUE PRECISAR CAMINHAR FAÇA POR 1'.","esfriamento":"5 MIN CAMINHADA"},"INI6K-400X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"6KM INTERCALANDO 400M CORRIDA X 200M CAMINHADA.","esfriamento":"5 MIN CAMINHADA"},"INI6KM-1800X200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"6KM INTERCALANDO 1,8KM CORRENDO X 200M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI6KM-1KMX200M":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"5 X (1KM CORRENDO X 200M CAMINHANDO)","esfriamento":"5MIN CAMINHADA"},"INI6KM-200FX200":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"6KM INTERCALANDO 200M CORRENDO MAIS FORTE X 200M CAMINHANDO","esfriamento":"5 MIN CAMINHADA"},"INI6KM-400F X 100":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"6KM INTERCALANDO 400M MAIS FORTE X 100M CAMINHANDO","esfriamento":"5MIN CAMINHADA"},"INI6KM-500X100":{"tipo":"INICIANTE","aquecimento":"5 MIN CAMINHADA","principal":"6KM INTERCALANDO 500M CORRENDO  X 100M CAMINHANDO","esfriamento":"5 MIN CAMINHANDO"},"INT10-1KMX2'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"10 TIROS DE 1KM (Z5) x RECUPERAÇÃO 2 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT10-2KMX5'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"5 TIROS DE 2KM (Z5) x RECUPERAÇÃO 5 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT10-300X200":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"10KM - TIROS DE 300M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT10-400X100":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"10KM - TIROS DE 400M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT10-700X300":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"10KM - TIROS DE 700M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT10-800X200":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"10KM - TIROS DE 800M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT40MIN-1'X1'":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"40 MIN - TIROS DE 1' (Z5) x RECUPERAÇÃO DE 1' (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT40MIN-2'X2'":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"40 MIN - TIROS DE 2' (Z5) x RECUPERAÇÃO DE 2' (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT40MIN-3'X2'":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"40 MIN - TIROS DE 3' (Z5) x RECUPERAÇÃO DE 2' (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT40MIN-4'X1'":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"40 MIN - TIROS DE 4' (Z5) x RECUPERAÇÃO DE 1' (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-100X100":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 100M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-200X200":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 200M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-2KMX5'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"3 TIROS DE 2KM (Z5) x RECUPERAÇÃO 5 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT6-300X200":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 300M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-3KMX6'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"2 TIROS DE 3KM (Z5) x RECUPERAÇÃO 6 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT6-400X1'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"15 X TIROS DE 400M (Z5) X 1 MIN RECUPERANDO PARADO","esfriamento":"5 MIN TROTE"},"INT6-400X100":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 400M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-400X200":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 400M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT6-500X1'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"12 X TIROS DE 500M (Z5) X 1 MIN RECUPERANDO PARADO","esfriamento":"5 MIN TROTE"},"INT6-500X100":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"6KM - TIROS DE 500M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT7-100X100":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"7KM - TIROS DE 100M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT7-1KMX2'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"7 TIROS DE 1KM (Z5) x RECUPERAÇÃO 2 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT7-400X300":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"7KM - TIROS DE 400M (Z5) x RECUPERAÇÃO DE 300M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT7-500X200":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"7KM - TIROS DE 500M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT7-600X100":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"7KM - TIROS DE 600M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT8-1KMX2'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"8 TIROS DE 1KM (Z5) x RECUPERAÇÃO 2 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT8-200X200":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"8KM - TIROS DE 200M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT8-2KMX5'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"4 TIROS DE 2KM (Z5) x RECUPERAÇÃO 5 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT8-300X200":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"8KM - TIROS DE 300M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT8-400X100":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"8KM - TIROS DE 400M (Z5) x RECUPERAÇÃO DE 100M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT8-4KMX7'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"2 TIROS DE 4KM (Z5) x RECUPERAÇÃO 7 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT8-600X200":{"tipo":"INTERVALADO","aquecimento":"1KM DE TROTE","principal":"8KM - TIROS DE 600M (Z5) x RECUPERAÇÃO DE 200M (Z1/Z2)","esfriamento":"5 MIN TROTE"},"INT9-1KMX2'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"9 TIROS DE 1KM (Z5) x RECUPERAÇÃO 2 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"INT9-3KMX6'":{"tipo":"INTERVALADO","aquecimento":"5 MIN TROTE","principal":"3 TIROS DE 3KM (Z5) x RECUPERAÇÃO 6 MINUTOS PARADO","esfriamento":"5 MIN TROTE"},"LON16":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 16KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON17":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 17KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON18":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 18KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON19":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 19KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON20":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 20KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON21":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 21KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON22":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 22KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON23":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 23KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON24":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 24KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON25":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 25KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON26":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 26KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON27":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 27KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON28":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 28KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON29":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 29KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON30":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 30KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON31":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 31KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON32":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 32KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON33":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 33KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON34":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 34KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON35":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 35KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON36":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 36KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"LON37":{"tipo":"LONGO","aquecimento":"NÃO","principal":"RODAGEM DE 37KM ENTRE Z2 E Z3","esfriamento":"NÃO"},"MARAT":{"tipo":"PROVA","aquecimento":"5 MIN TROTE","principal":"42KM DE CORRIDA","esfriamento":"NÃO"},"MEIA":{"tipo":"PROVA","aquecimento":"NÃO","principal":"21KM DE CORRIDA","esfriamento":"NÃO"},"PIR7k - 2|1|1|1|2":{"tipo":"MISTO","aquecimento":"NÃO","principal":"2KM - LEVE (Z2) + 1KM MODERADO (Z3) + 1 KM FORTE (Z4) + 1KM MODERADO (Z3) + 1KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"PRO10-1KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"10KM AUMENTANDO INTENSIDADE A CADA 1 KM","esfriamento":"5 MIN TROTE"},"PRO10-2KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"10KM AUMENTANDO INTENSIDADE A CADA 2 KM","esfriamento":"5 MIN TROTE"},"PRO12-1KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"12KM AUMENTANDO INTENSIDADE A CADA 1 KM","esfriamento":"5 MIN TROTE"},"PRO12-2KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"12KM AUMENTANDO INTENSIDADE A CADA 2 KM","esfriamento":"5 MIN TROTE"},"PRO12-3KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"12KM AUMENTANDO INTENSIDADE A CADA 3 KM","esfriamento":"5 MIN TROTE"},"PRO12-4KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"12KM AUMENTANDO INTENSIDADE A CADA 4 KM","esfriamento":"5 MIN TROTE"},"PRO16-4KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"16KM AUMENTANDO INTENSIDADE A CADA 4 KM","esfriamento":"5 MIN TROTE"},"PRO30-10|10|10":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"10' LEVE (Z2) + 10' MODERADO (Z3) + 10' FORTE (Z4)","esfriamento":"5 MIN TROTE"},"PRO40-20|10|10":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"20' LEVE (Z2) + 10' MODERADO (Z3) + 10' FORTE (Z4)","esfriamento":"5 MIN TROTE"},"PRO50-20|20|10":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"20' LEVE (Z2) + 20' MODERADO (Z3) + 10' FORTE (Z4)","esfriamento":"5 MIN TROTE"},"PRO60-20|20|20":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"20' LEVE (Z2) + 20' MODERADO (Z3) + 20' FORTE (Z4)","esfriamento":"5 MIN TROTE"},"PRO6-2KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"6KM AUMENTANDO INTENSIDADE A CADA 2 KM","esfriamento":"5 MIN TROTE"},"PRO7-1KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"7KM AUMENTANDO INTENSIDADE A CADA 1 KM","esfriamento":"5 MIN TROTE"},"PRO8-1KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"8KM AUMENTANDO INTENSIDADE A CADA 1 KM","esfriamento":"5 MIN TROTE"},"PRO8-2KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"8KM AUMENTANDO INTENSIDADE A CADA 2 KM","esfriamento":"5 MIN TROTE"},"PRO9-1KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"9KM AUMENTANDO INTENSIDADE A CADA 1 KM","esfriamento":"5 MIN TROTE"},"PRO9-3KM":{"tipo":"PROGRESSIVO","aquecimento":"NÃO","principal":"9KM AUMENTANDO INTENSIDADE A CADA 3 KM","esfriamento":"5 MIN TROTE"},"PROVA10KM":{"tipo":"PROVA","aquecimento":"5 MIN TROTE","principal":"10KM DE CORRIDA","esfriamento":"NÃO"},"PROVA5KM":{"tipo":"PROVA","aquecimento":"5 MIN TROTE","principal":"5KM DE CORRIDA","esfriamento":"NÃO"},"RIT10KM":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"10KM RITMO 5 A 7 SEGUNDOS MAIS RÁPIDO QUE Z3","esfriamento":"5 MIN TROTE"},"RIT14KM":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"14KM 5 A 7 SEGUNDOS MAIS RÁPIDO QUE Z3","esfriamento":"5 MIN TROTE"},"RIT8KM":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"8KM RITMO 5 A 7 SEGUNDOS MAIS RÁPIDO QUE Z3","esfriamento":"5 MIN TROTE"},"ROD10":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 10KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD11":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 11KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD12":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 12KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD13":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 13KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD14":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 14KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD15":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 15KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD5":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 5KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD6":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 6KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD7":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 7KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD8":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 8KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"ROD9":{"tipo":"RODAGEM","aquecimento":"5 MIN TROTE","principal":"RODAGEM DE 9KM EM Z3 (MODERADO)","esfriamento":"5 MIN TROTE"},"TESTE":{"tipo":"TESTE","aquecimento":"5 MIN DE TROTE","principal":"CORRER 3.200 METROS MAIS RÁPIDO QUE CONSEGUIR","esfriamento":"1KM DE TROTE"},"TRO10KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 10KM MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO12KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 12 KM EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO30":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 30 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO35":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 35 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO40":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 40 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO45":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 45 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO50":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 50 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO5KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 5KM MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO60":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 60 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO6KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 6KM MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO70":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 70 MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO7KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 7KM MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"TRO8KM":{"tipo":"TROTE","aquecimento":"NÃO","principal":"TROTE DE 8KM MINUTOS EM Z2 (LEVE)","esfriamento":"NÃO"},"RIT-6K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 2KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"RIT-7K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 3KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"RIT-8K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 4KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"RIT-9K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 5KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"RIT-10K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 6KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"RIT-12K":{"tipo":"RITMO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 8KM FORTE (Z4) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"PIR-5K":{"tipo":"MISTO","aquecimento":"5 MIN TROTE","principal":"1KM LEVE (Z2) + 1KM MODERADO (Z3) + 1KM FORTE (Z4) + 1KM MODERADO (Z3) + 1KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"PIR-7K":{"tipo":"MISTO","aquecimento":"5 MIN TROTE","principal":"1KM LEVE (Z2) + 2KM MODERADO (Z3) + 1KM FORTE (Z4) + 2KM MODERADO (Z3) + 1KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"PIR-10K":{"tipo":"MISTO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 2KM MODERADO (Z3) + 2KM FORTE (Z4) + 2KM MODERADO (Z3) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"},"PIR-12K":{"tipo":"MISTO","aquecimento":"5 MIN TROTE","principal":"2KM LEVE (Z2) + 3KM MODERADO (Z3) + 2KM FORTE (Z4) + 3KM MODERADO (Z3) + 2KM LEVE (Z2)","esfriamento":"5 MIN TROTE"}};
const RD_PLANOS_CORRIDA={"ini5":{"1":[{"dia":"terça","codigo":"INI35-1'X1'"},{"dia":"quinta","codigo":"INI4KM-200X200"},{"dia":"sábado","codigo":"INI4KM-300X200"}],"2":[{"dia":"terça","codigo":"INI40-3'X1'"},{"dia":"quinta","codigo":"INI45-1'X1'"},{"dia":"sábado","codigo":"INI50-4'X1'"}],"3":[{"dia":"terça","codigo":"INI5KM-4'X1'"},{"dia":"quinta","codigo":"INI5K-100X100|300X200"},{"dia":"sábado","codigo":"INI6K-400X200"}],"4":[{"dia":"terça","codigo":"INI45-1'X1'"},{"dia":"quinta","codigo":"INI5K-700MX300M"},{"dia":"sábado","codigo":"INI5KM-100FX100"}],"5":[{"dia":"terça","codigo":"INI6KM-500X100"},{"dia":"quinta","codigo":"INI5KM-800X200"},{"dia":"sábado","codigo":"INI45-1'X1'"}],"6":[{"dia":"terça","codigo":"INI5KM-900X100"},{"dia":"quinta","codigo":"INI6KM-200FX200"},{"dia":"sábado","codigo":"INI6KM-1KMX200M"}],"7":[{"dia":"terça","codigo":"INI6KM-1800X200"},{"dia":"quinta","codigo":"INI45-1'X1'"},{"dia":"sábado","codigo":"INI5KM-2,5KMX4' PARADO"}],"8":[{"dia":"terça","codigo":"INI6KM-400F X 100"},{"dia":"quinta","codigo":"INI5KM-TESTE"},{"dia":"sábado","codigo":"PROVA5KM"}]},"ini10":{"1":[{"dia":"terça","codigo":"ROD5"},{"dia":"quinta","codigo":"FAR6-300X300"},{"dia":"sábado","codigo":"ROD6"}],"2":[{"dia":"terça","codigo":"PRO6-2KM"},{"dia":"quinta","codigo":"INT6-300X200"},{"dia":"sábado","codigo":"ROD7"}],"3":[{"dia":"terça","codigo":"TRO40"},{"dia":"quinta","codigo":"INT6-400X100"},{"dia":"sábado","codigo":"ROD7"}],"4":[{"dia":"terça","codigo":"FAR7KM-2'X2'"},{"dia":"quinta","codigo":"PRO7-1KM"},{"dia":"sábado","codigo":"ROD8"}],"5":[{"dia":"terça","codigo":"TRO50"},{"dia":"quinta","codigo":"FAR6-600X600"},{"dia":"sábado","codigo":"PRO40-20|10|10"}],"6":[{"dia":"terça","codigo":"ROD7"},{"dia":"quinta","codigo":"INT40MIN-3'X2'"},{"dia":"sábado","codigo":"PRO8-1KM"}],"7":[{"dia":"terça","codigo":"TRO6KM"},{"dia":"quinta","codigo":"INT7-1KMX2'"},{"dia":"sábado","codigo":"ROD9"}],"8":[{"dia":"terça","codigo":"ROD6"},{"dia":"quinta","codigo":"INT6-3KMX6'"},{"dia":"sábado","codigo":"ROD9"}],"9":[{"dia":"terça","codigo":"TRO50"},{"dia":"quinta","codigo":"INT40MIN-1'X1'"},{"dia":"sábado","codigo":"PRO50-20|20|10"}],"10":[{"dia":"terça","codigo":"FAR6-400X200"},{"dia":"quinta","codigo":"TRO35"},{"dia":"sábado","codigo":"PROVA10KM"}]},"ini21":{"1":[{"dia":"segunda","codigo":"ROD7"},{"dia":"quarta","codigo":"INT6-500X1'"},{"dia":"sexta","codigo":"PRO40-20|10|10"},{"dia":"domingo","codigo":"ROD9"}],"2":[{"dia":"segunda","codigo":"ROD6"},{"dia":"quarta","codigo":"INT40MIN-4'X1'"},{"dia":"sexta","codigo":"TRO7KM"},{"dia":"domingo","codigo":"ROD11"}],"3":[{"dia":"segunda","codigo":"ROD5"},{"dia":"quarta","codigo":"PRO7-1KM"},{"dia":"sexta","codigo":"FAR7KM-2'X2'"},{"dia":"domingo","codigo":"ROD12"}],"4":[{"dia":"segunda","codigo":"ROD7"},{"dia":"quarta","codigo":"INT8-300X200"},{"dia":"sexta","codigo":"PRO9-3KM"},{"dia":"domingo","codigo":"ROD10"}],"5":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"FAR10-400X400"},{"dia":"sexta","codigo":"ROD8"},{"dia":"domingo","codigo":"RIT14KM"}],"6":[{"dia":"segunda","codigo":"ROD7"},{"dia":"quarta","codigo":"INT10-800X200"},{"dia":"sexta","codigo":"ROD11"},{"dia":"domingo","codigo":"PRO10-2KM"}],"7":[{"dia":"segunda","codigo":"TRO50"},{"dia":"quarta","codigo":"INT10-700X300"},{"dia":"sexta","codigo":"ROD6"},{"dia":"domingo","codigo":"LON16"}],"8":[{"dia":"segunda","codigo":"ROD6"},{"dia":"quarta","codigo":"TRO40"},{"dia":"sexta","codigo":"PRO60-20|20|20"},{"dia":"domingo","codigo":"FAR12-1KMX1KM"}],"9":[{"dia":"segunda","codigo":"ROD8"},{"dia":"quarta","codigo":"FAR6-400X200"},{"dia":"sexta","codigo":"ROD7"},{"dia":"domingo","codigo":"LON18"}],"10":[{"dia":"segunda","codigo":"TRO35"},{"dia":"quarta","codigo":"FAR8-500X500"},{"dia":"sexta","codigo":"ROD6"},{"dia":"domingo","codigo":"ROD14"}],"11":[{"dia":"segunda","codigo":"ROD6"},{"dia":"quarta","codigo":"FAR6-400X200"},{"dia":"sexta","codigo":"TRO40"},{"dia":"domingo","codigo":"FAR12-3KMX3KM"}],"12":[{"dia":"segunda","codigo":"TRO35"},{"dia":"quarta","codigo":"ROD10"},{"dia":"sexta","codigo":"TRO45"},{"dia":"domingo","codigo":"MEIA"}]},"ini42":{"1":[{"dia":"segunda","codigo":"ROD8"},{"dia":"terça","codigo":"FAR6-600X600"},{"dia":"quinta","codigo":"TRO45"},{"dia":"sábado","codigo":"ROD6"},{"dia":"domingo","codigo":"ROD13"}],"2":[{"dia":"segunda","codigo":"ROD6"},{"dia":"terça","codigo":"FAR7KM-2'X2'"},{"dia":"quinta","codigo":"INT40MIN-2'X2'"},{"dia":"sábado","codigo":"TRO35"},{"dia":"domingo","codigo":"ROD15"}],"3":[{"dia":"segunda","codigo":"TRO45"},{"dia":"terça","codigo":"ROD8"},{"dia":"quinta","codigo":"INT7-1KMX2'"},{"dia":"sábado","codigo":"PRO6-2KM"},{"dia":"domingo","codigo":"LON17"}],"4":[{"dia":"segunda","codigo":"ROD7"},{"dia":"terça","codigo":"PRO50-20|20|10"},{"dia":"quinta","codigo":"INT8-600X200"},{"dia":"sábado","codigo":"ROD5"},{"dia":"domingo","codigo":"LON19"}],"5":[{"dia":"segunda","codigo":"ROD6"},{"dia":"terça","codigo":"TRO40"},{"dia":"quinta","codigo":"INT8-2KMX5'"},{"dia":"sábado","codigo":"TRO35"},{"dia":"domingo","codigo":"LON23"}],"6":[{"dia":"segunda","codigo":"TRO50"},{"dia":"terça","codigo":"FAR8-600X200"},{"dia":"quinta","codigo":"INT8-300X200"},{"dia":"sábado","codigo":"ROD9"},{"dia":"domingo","codigo":"FAR12-500X500"}],"7":[{"dia":"segunda","codigo":"ROD9"},{"dia":"terça","codigo":"TRO30"},{"dia":"quinta","codigo":"INT40MIN-3'X2'"},{"dia":"sábado","codigo":"ROD6"},{"dia":"domingo","codigo":"LON26"}],"8":[{"dia":"segunda","codigo":"ROD5"},{"dia":"terça","codigo":"ROD8"},{"dia":"quinta","codigo":"INT7-500X200"},{"dia":"sábado","codigo":"ROD7"},{"dia":"domingo","codigo":"RIT14KM"}],"9":[{"dia":"segunda","codigo":"ROD5"},{"dia":"terça","codigo":"PRO8-2KM"},{"dia":"quinta","codigo":"FAR7KM-2'X2'"},{"dia":"sábado","codigo":"TRO30"},{"dia":"domingo","codigo":"LON29"}],"10":[{"dia":"segunda","codigo":"TRO5KM"},{"dia":"terça","codigo":"PRO50-20|20|10"},{"dia":"quinta","codigo":"INT7-1KMX2'"},{"dia":"sábado","codigo":"FAR10-500X500"},{"dia":"domingo","codigo":"RIT10KM"}],"11":[{"dia":"segunda","codigo":"ROD7"},{"dia":"terça","codigo":"ROD5"},{"dia":"quinta","codigo":"INT8-300X200"},{"dia":"sábado","codigo":"ROD6"},{"dia":"domingo","codigo":"LON32"}],"12":[{"dia":"segunda","codigo":"TRO30"},{"dia":"terça","codigo":"ROD6"},{"dia":"quinta","codigo":"INT10-700X300"},{"dia":"sábado","codigo":"PRO10-2KM"},{"dia":"domingo","codigo":"ROD12"}],"13":[{"dia":"segunda","codigo":"ROD6"},{"dia":"terça","codigo":"FAR6-400X400"},{"dia":"quinta","codigo":"PRO6-2KM"},{"dia":"sábado","codigo":"TRO35"},{"dia":"domingo","codigo":"LON35"}],"14":[{"dia":"segunda","codigo":"TRO30"},{"dia":"terça","codigo":"FAR7KM-2'X2'"},{"dia":"quinta","codigo":"ROD6"},{"dia":"sábado","codigo":"ROD7"},{"dia":"domingo","codigo":"PRO16-4KM"}],"15":[{"dia":"segunda","codigo":"ROD5"},{"dia":"terça","codigo":"FAR8-600X200"},{"dia":"quinta","codigo":"INT6-3KMX6'"},{"dia":"sábado","codigo":"RIT8KM"},{"dia":"domingo","codigo":"ROD12"}],"16":[{"dia":"segunda","codigo":"TRO40"},{"dia":"terça","codigo":"FAR6-400X400"},{"dia":"quinta","codigo":"ROD6"},{"dia":"sábado","codigo":"TRO30"},{"dia":"domingo","codigo":"MARAT"}]},"int5":{"1":[{"dia":"terça","codigo":"TRO40"},{"dia":"quinta","codigo":"FAR6-400X400"},{"dia":"sábado","codigo":"ROD8"}],"2":[{"dia":"terça","codigo":"PRO6-2KM"},{"dia":"quinta","codigo":"INT6-200X200"},{"dia":"sábado","codigo":"ROD9"}],"3":[{"dia":"terça","codigo":"ROD7"},{"dia":"quinta","codigo":"INT6-500X100"},{"dia":"sábado","codigo":"ROD10"}],"4":[{"dia":"terça","codigo":"TRO50"},{"dia":"quinta","codigo":"FAR7KM-2'X2'"},{"dia":"sábado","codigo":"PRO9-1KM"}],"5":[{"dia":"terça","codigo":"ROD8"},{"dia":"quinta","codigo":"INT40MIN-1'X1'"},{"dia":"sábado","codigo":"RIT8KM"}],"6":[{"dia":"terça","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"quinta","codigo":"INT7-1KMX2'"},{"dia":"sábado","codigo":"ROD10"}],"7":[{"dia":"terça","codigo":"FAR8-500X300"},{"dia":"quinta","codigo":"INT6-400X200"},{"dia":"sábado","codigo":"PRO50-20|20|10"}],"8":[{"dia":"terça","codigo":"ROD8"},{"dia":"quinta","codigo":"TRO50"},{"dia":"sábado","codigo":"PROVA5KM"}]},"int10":{"1":[{"dia":"terça","codigo":"ROD8"},{"dia":"quinta","codigo":"FAR8-800X800"},{"dia":"sábado","codigo":"ROD10"}],"2":[{"dia":"terça","codigo":"TRO40"},{"dia":"quinta","codigo":"FAR7KM-2'X2'"},{"dia":"sábado","codigo":"PRO12-3KM"}],"3":[{"dia":"terça","codigo":"ROD7"},{"dia":"quinta","codigo":"INT8-1KMX2'"},{"dia":"sábado","codigo":"ROD12"}],"4":[{"dia":"terça","codigo":"FAR8-500X300"},{"dia":"quinta","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"sábado","codigo":"ROD9"}],"5":[{"dia":"terça","codigo":"TRO40"},{"dia":"quinta","codigo":"INT8-2KMX5'"},{"dia":"sábado","codigo":"ROD15"}],"6":[{"dia":"terça","codigo":"ROD7"},{"dia":"quinta","codigo":"FAR8-400X400"},{"dia":"sábado","codigo":"PRO10-2KM"}],"7":[{"dia":"terça","codigo":"TRO5KM"},{"dia":"quinta","codigo":"INT6-100X100"},{"dia":"sábado","codigo":"FAR12-2KMX1KM"}],"8":[{"dia":"terça","codigo":"ROD10"},{"dia":"quinta","codigo":"INT10-800X200"},{"dia":"sábado","codigo":"LON16"}],"9":[{"dia":"terça","codigo":"TRO45"},{"dia":"quinta","codigo":"PRO50-20|20|10"},{"dia":"sábado","codigo":"ROD12"}],"10":[{"dia":"terça","codigo":"ROD5"},{"dia":"quinta","codigo":"TRO40"},{"dia":"sábado","codigo":"PROVA10KM"}]},"int21":{"1":[{"dia":"segunda","codigo":"ROD10"},{"dia":"quarta","codigo":"FAR8-800X800"},{"dia":"sexta","codigo":"PRO9-3KM"},{"dia":"domingo","codigo":"ROD12"}],"2":[{"dia":"segunda","codigo":"TRO50"},{"dia":"quarta","codigo":"INT10-800X200"},{"dia":"sexta","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"domingo","codigo":"ROD10"}],"3":[{"dia":"segunda","codigo":"ROD9"},{"dia":"quarta","codigo":"INT7-1KMX2'"},{"dia":"sexta","codigo":"FAR10-600X400"},{"dia":"domingo","codigo":"FAR12-2KMX1KM"}],"4":[{"dia":"segunda","codigo":"TRO60"},{"dia":"quarta","codigo":"INT10-300X200"},{"dia":"sexta","codigo":"PRO12-2KM"},{"dia":"domingo","codigo":"ROD15"}],"5":[{"dia":"segunda","codigo":"ROD7"},{"dia":"quarta","codigo":"INT10-700X300"},{"dia":"sexta","codigo":"PRO12-3KM"},{"dia":"domingo","codigo":"LON17"}],"6":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"FAR8-500X500"},{"dia":"sexta","codigo":"ROD10"},{"dia":"domingo","codigo":"ROD14"}],"7":[{"dia":"segunda","codigo":"ROD10"},{"dia":"quarta","codigo":"INT9-1KMX2'"},{"dia":"sexta","codigo":"PRO12-4KM"},{"dia":"domingo","codigo":"LON16"}],"8":[{"dia":"segunda","codigo":"ROD12"},{"dia":"quarta","codigo":"FAR12-3KMX3KM"},{"dia":"sexta","codigo":"TRO70"},{"dia":"domingo","codigo":"RIT14KM"}],"9":[{"dia":"segunda","codigo":"ROD13"},{"dia":"quarta","codigo":"FAR10-500X500"},{"dia":"sexta","codigo":"TRO50"},{"dia":"domingo","codigo":"LON19"}],"10":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"FAR10-700X300"},{"dia":"sexta","codigo":"ROD13"},{"dia":"domingo","codigo":"ROD15"}],"11":[{"dia":"segunda","codigo":"TRO60"},{"dia":"quarta","codigo":"FAR8-400X400"},{"dia":"sexta","codigo":"PRO10-2KM"},{"dia":"domingo","codigo":"ROD12"}],"12":[{"dia":"segunda","codigo":"ROD8"},{"dia":"quarta","codigo":"PRO60-20|20|20"},{"dia":"sexta","codigo":"TRO50"},{"dia":"domingo","codigo":"MEIA"}]},"int42":{"1":[{"dia":"segunda","codigo":"TRO50"},{"dia":"terça","codigo":"FAR10-400X400"},{"dia":"quinta","codigo":"PRO10-2KM"},{"dia":"sábado","codigo":"ROD8"},{"dia":"domingo","codigo":"ROD15"}],"2":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"PRO12-2KM"},{"dia":"quinta","codigo":"INT10-800X200"},{"dia":"sábado","codigo":"ROD14"},{"dia":"domingo","codigo":"LON18"}],"3":[{"dia":"segunda","codigo":"TRO60"},{"dia":"terça","codigo":"ROD13"},{"dia":"quinta","codigo":"INT10-800X200"},{"dia":"sábado","codigo":"TRO60"},{"dia":"domingo","codigo":"LON24"}],"4":[{"dia":"segunda","codigo":"TRO50"},{"dia":"terça","codigo":"ROD15"},{"dia":"quinta","codigo":"INT8-1KMX2'"},{"dia":"sábado","codigo":"ROD10"},{"dia":"domingo","codigo":"LON17"}],"5":[{"dia":"segunda","codigo":"TRO70"},{"dia":"terça","codigo":"PRO12-4KM"},{"dia":"quinta","codigo":"FAR10-700X300"},{"dia":"sábado","codigo":"ROD13"},{"dia":"domingo","codigo":"LON18"}],"6":[{"dia":"segunda","codigo":"ROD15"},{"dia":"terça","codigo":"FAR12-1KMX1KM"},{"dia":"quinta","codigo":"INT8-4KMX7'"},{"dia":"sábado","codigo":"FAR12-500X500"},{"dia":"domingo","codigo":"LON22"}],"7":[{"dia":"segunda","codigo":"ROD15"},{"dia":"terça","codigo":"FAR8-800X800"},{"dia":"quinta","codigo":"PRO12-2KM"},{"dia":"sábado","codigo":"LON16"},{"dia":"domingo","codigo":"LON25"}],"8":[{"dia":"segunda","codigo":"TRO70"},{"dia":"terça","codigo":"PRO16-4KM"},{"dia":"quinta","codigo":"INT9-1KMX2'"},{"dia":"sábado","codigo":"ROD10"},{"dia":"domingo","codigo":"LON27"}],"9":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"ROD12"},{"dia":"quinta","codigo":"PRO7-1KM"},{"dia":"sábado","codigo":"TRO40"},{"dia":"domingo","codigo":"LON30"}],"10":[{"dia":"segunda","codigo":"TRO45"},{"dia":"terça","codigo":"PRO16-4KM"},{"dia":"quinta","codigo":"FAR10-500X500"},{"dia":"sábado","codigo":"ROD15"},{"dia":"domingo","codigo":"LON18"}],"11":[{"dia":"segunda","codigo":"ROD13"},{"dia":"terça","codigo":"RIT14KM"},{"dia":"quinta","codigo":"INT8-4KMX7'"},{"dia":"sábado","codigo":"TRO70"},{"dia":"domingo","codigo":"LON25"}],"12":[{"dia":"segunda","codigo":"ROD14"},{"dia":"terça","codigo":"TRO50"},{"dia":"quinta","codigo":"FAR12-1KMX1KM"},{"dia":"sábado","codigo":"TRO40"},{"dia":"domingo","codigo":"LON32"}],"13":[{"dia":"segunda","codigo":"ROD8"},{"dia":"terça","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"quinta","codigo":"ROD10"},{"dia":"sábado","codigo":"TRO40"},{"dia":"domingo","codigo":"LON35"}],"14":[{"dia":"segunda","codigo":"ROD6"},{"dia":"terça","codigo":"FAR10-600X400"},{"dia":"quinta","codigo":"PRO9-3KM"},{"dia":"sábado","codigo":"ROD10"},{"dia":"domingo","codigo":"FAR12-1KMX1KM"}],"15":[{"dia":"segunda","codigo":"TRO70"},{"dia":"terça","codigo":"FAR10-700X300"},{"dia":"quinta","codigo":"INT10-800X200"},{"dia":"sábado","codigo":"ROD12"},{"dia":"domingo","codigo":"ROD14"}],"16":[{"dia":"segunda","codigo":"ROD8"},{"dia":"terça","codigo":"TRO50"},{"dia":"quinta","codigo":"ROD10"},{"dia":"sábado","codigo":"TRO35"},{"dia":"domingo","codigo":"MARAT"}]},"ava5":{"1":[{"dia":"segunda","codigo":"TRO50"},{"dia":"quarta","codigo":"FAR8-600X200"},{"dia":"sexta","codigo":"PRO7-1KM"},{"dia":"domingo","codigo":"ROD10"}],"2":[{"dia":"segunda","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"quarta","codigo":"INT40MIN-2'X2'"},{"dia":"sexta","codigo":"ROD8"},{"dia":"domingo","codigo":"FAR12-500X500"}],"3":[{"dia":"segunda","codigo":"ROD10"},{"dia":"quarta","codigo":"FAR8-400X400"},{"dia":"sexta","codigo":"TRO45"},{"dia":"domingo","codigo":"ROD13"}],"4":[{"dia":"segunda","codigo":"ROD5"},{"dia":"quarta","codigo":"INT7-500X200"},{"dia":"sexta","codigo":"PRO8-2KM"},{"dia":"domingo","codigo":"ROD10"}],"5":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"RIT8KM"},{"dia":"sexta","codigo":"INT7-1KMX2'"},{"dia":"domingo","codigo":"LON16"}],"6":[{"dia":"segunda","codigo":"ROD5"},{"dia":"quarta","codigo":"FAR6-300X300"},{"dia":"sexta","codigo":"TRO35"},{"dia":"domingo","codigo":"ROD12"}],"7":[{"dia":"segunda","codigo":"PRO30-10|10|10"},{"dia":"quarta","codigo":"INT10-700X300"},{"dia":"sexta","codigo":"TRO50"},{"dia":"domingo","codigo":"ROD9"}],"8":[{"dia":"segunda","codigo":"FAR6-500X500"},{"dia":"quarta","codigo":"ROD5"},{"dia":"sexta","codigo":"TRO35"},{"dia":"domingo","codigo":"PROVA5KM"}]},"ava10":{"1":[{"dia":"segunda","codigo":"ROD9"},{"dia":"quarta","codigo":"FAR10-500X500"},{"dia":"sexta","codigo":"PRO12-3KM"},{"dia":"domingo","codigo":"LON16"}],"2":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"FAR8-600X200"},{"dia":"sexta","codigo":"PRO50-20|20|10"},{"dia":"domingo","codigo":"ROD12"}],"3":[{"dia":"segunda","codigo":"ROD7"},{"dia":"quarta","codigo":"INT8-200X200"},{"dia":"sexta","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"domingo","codigo":"ROD10"}],"4":[{"dia":"segunda","codigo":"PRO9-3KM"},{"dia":"quarta","codigo":"INT7-1KMX2'"},{"dia":"sexta","codigo":"TRO40"},{"dia":"domingo","codigo":"ROD13"}],"5":[{"dia":"segunda","codigo":"TRO50"},{"dia":"quarta","codigo":"INT10-300X200"},{"dia":"sexta","codigo":"PRO10-2KM"},{"dia":"domingo","codigo":"ROD14"}],"6":[{"dia":"segunda","codigo":"ROD5"},{"dia":"quarta","codigo":"FAR12-500X500"},{"dia":"sexta","codigo":"TRO45"},{"dia":"domingo","codigo":"LON17"}],"7":[{"dia":"segunda","codigo":"TRO7KM"},{"dia":"quarta","codigo":"INT8-4KMX7'"},{"dia":"sexta","codigo":"FAR6-300X300"},{"dia":"domingo","codigo":"RIT10KM"}],"8":[{"dia":"segunda","codigo":"ROD8"},{"dia":"quarta","codigo":"PRO40-20|10|10"},{"dia":"sexta","codigo":"INT10-2KMX5'"},{"dia":"domingo","codigo":"ROD12"}],"9":[{"dia":"segunda","codigo":"TRO40"},{"dia":"quarta","codigo":"INT6-200X200"},{"dia":"sexta","codigo":"FAR10-400X400"},{"dia":"domingo","codigo":"ROD12"}],"10":[{"dia":"segunda","codigo":"ROD6"},{"dia":"quarta","codigo":"FAR7KM-2'X2'"},{"dia":"sexta","codigo":"TRO35"},{"dia":"domingo","codigo":"PROVA10KM"}]},"ava21":{"1":[{"dia":"segunda","codigo":"ROD8"},{"dia":"terça","codigo":"PRO10-1KM"},{"dia":"quarta","codigo":"TRO50"},{"dia":"sexta","codigo":"FAR10-400X400"},{"dia":"domingo","codigo":"ROD14"}],"2":[{"dia":"segunda","codigo":"TRO45"},{"dia":"terça","codigo":"FAR12-600X600"},{"dia":"quarta","codigo":"ROD10"},{"dia":"sexta","codigo":"INT10-800X200"},{"dia":"domingo","codigo":"LON16"}],"3":[{"dia":"segunda","codigo":"PRO60-20|20|20"},{"dia":"terça","codigo":"FAR8-500X300"},{"dia":"quarta","codigo":"PRO12-4KM"},{"dia":"sexta","codigo":"INT7-1KMX2'"},{"dia":"domingo","codigo":"ROD15"}],"4":[{"dia":"segunda","codigo":"TRO60"},{"dia":"terça","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"quarta","codigo":"ROD8"},{"dia":"sexta","codigo":"INT9-1KMX2'"},{"dia":"domingo","codigo":"LON18"}],"5":[{"dia":"segunda","codigo":"TRO45"},{"dia":"terça","codigo":"ROD8"},{"dia":"quarta","codigo":"FAR12-2KMX1KM"},{"dia":"sexta","codigo":"INT6-3KMX6'"},{"dia":"domingo","codigo":"LON17"}],"6":[{"dia":"segunda","codigo":"ROD7"},{"dia":"terça","codigo":"FAR12-1KMX1KM"},{"dia":"quarta","codigo":"ROD12"},{"dia":"sexta","codigo":"INT40MIN-1'X1'"},{"dia":"domingo","codigo":"LON20"}],"7":[{"dia":"segunda","codigo":"TRO50"},{"dia":"terça","codigo":"PRO9-1KM"},{"dia":"quarta","codigo":"ROD7"},{"dia":"sexta","codigo":"INT6-2KMX5'"},{"dia":"domingo","codigo":"PRO16-4KM"}],"8":[{"dia":"segunda","codigo":"ROD9"},{"dia":"terça","codigo":"INT7-500X200"},{"dia":"quarta","codigo":"ROD8"},{"dia":"sexta","codigo":"PRO12-1KM"},{"dia":"domingo","codigo":"LON19"}],"9":[{"dia":"segunda","codigo":"ROD7"},{"dia":"terça","codigo":"FAR8-500X300"},{"dia":"quarta","codigo":"TRO40"},{"dia":"sexta","codigo":"INT9-3KMX6'"},{"dia":"domingo","codigo":"LON24"}],"10":[{"dia":"segunda","codigo":"TRO35"},{"dia":"terça","codigo":"RIT14KM"},{"dia":"quarta","codigo":"PRO60-20|20|20"},{"dia":"sexta","codigo":"ROD8"},{"dia":"domingo","codigo":"LON18"}],"11":[{"dia":"segunda","codigo":"ROD9"},{"dia":"terça","codigo":"FAR10-700X300"},{"dia":"quarta","codigo":"ROD8"},{"dia":"sexta","codigo":"INT40MIN-1'X1'"},{"dia":"domingo","codigo":"FAR12-1KMX1KM"}],"12":[{"dia":"segunda","codigo":"ROD7"},{"dia":"terça","codigo":"PRO6-2KM"},{"dia":"quarta","codigo":"ROD9"},{"dia":"sexta","codigo":"TRO40"},{"dia":"domingo","codigo":"MEIA"}]},"ava42":{"1":[{"dia":"segunda","codigo":"TRO50"},{"dia":"terça","codigo":"FAR12-600X600"},{"dia":"quarta","codigo":"PRO10-2KM"},{"dia":"quinta","codigo":"TRO60"},{"dia":"sábado","codigo":"ROD13"},{"dia":"domingo","codigo":"LON18"}],"2":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"FAR12-2KMX1KM"},{"dia":"quarta","codigo":"ROD14"},{"dia":"quinta","codigo":"INT10-700X300"},{"dia":"sábado","codigo":"ROD15"},{"dia":"domingo","codigo":"LON20"}],"3":[{"dia":"segunda","codigo":"TRO70"},{"dia":"terça","codigo":"FAR12-600X600"},{"dia":"quarta","codigo":"ROD15"},{"dia":"quinta","codigo":"INT9-1KMX2'"},{"dia":"sábado","codigo":"ROD15"},{"dia":"domingo","codigo":"LON21"}],"4":[{"dia":"segunda","codigo":"PRO12-3KM"},{"dia":"terça","codigo":"TRO70"},{"dia":"quarta","codigo":"ROD15"},{"dia":"quinta","codigo":"INT8-2KMX5'"},{"dia":"sábado","codigo":"ROD12"},{"dia":"domingo","codigo":"LON24"}],"5":[{"dia":"segunda","codigo":"ROD12"},{"dia":"terça","codigo":"FAR12-3KMX3KM"},{"dia":"quarta","codigo":"PIR7k - 2|1|1|1|2"},{"dia":"quinta","codigo":"ROD15"},{"dia":"sábado","codigo":"ROD14"},{"dia":"domingo","codigo":"LON28"}],"6":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"ROD15"},{"dia":"quarta","codigo":"INT9-3KMX6'"},{"dia":"quinta","codigo":"PRO16-4KM"},{"dia":"sábado","codigo":"TRO60"},{"dia":"domingo","codigo":"LON23"}],"7":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"FAR6-400X400"},{"dia":"quarta","codigo":"TRO50"},{"dia":"quinta","codigo":"INT10-2KMX5'"},{"dia":"sábado","codigo":"PRO40-20|10|10"},{"dia":"domingo","codigo":"LON25"}],"8":[{"dia":"segunda","codigo":"TRO60"},{"dia":"terça","codigo":"RIT14KM"},{"dia":"quarta","codigo":"ROD9"},{"dia":"quinta","codigo":"FAR10-700X300"},{"dia":"sábado","codigo":"ROD12"},{"dia":"domingo","codigo":"LON27"}],"9":[{"dia":"segunda","codigo":"ROD10"},{"dia":"terça","codigo":"FAR7KM-2'X2'"},{"dia":"quarta","codigo":"ROD12"},{"dia":"quinta","codigo":"PRO60-20|20|20"},{"dia":"domingo","codigo":"LON30"}],"10":[{"dia":"segunda","codigo":"TRO35"},{"dia":"terça","codigo":"ROD6"},{"dia":"quarta","codigo":"TRO50"},{"dia":"quinta","codigo":"FAR8-500X300"},{"dia":"sábado","codigo":"ROD5"},{"dia":"domingo","codigo":"LON32"}],"11":[{"dia":"segunda","codigo":"ROD5"},{"dia":"terça","codigo":"PRO10-1KM"},{"dia":"quarta","codigo":"TRO40"},{"dia":"quinta","codigo":"INT40MIN-1'X1'"},{"dia":"sábado","codigo":"ROD8"},{"dia":"domingo","codigo":"LON25"}],"12":[{"dia":"segunda","codigo":"TRO40"},{"dia":"terça","codigo":"FAR6-600X600"},{"dia":"quinta","codigo":"ROD10"},{"dia":"sábado","codigo":"TRO40"},{"dia":"domingo","codigo":"LON34"}],"13":[{"dia":"segunda","codigo":"TRO35"},{"dia":"terça","codigo":"ROD7"},{"dia":"quinta","codigo":"FAR8-400X400"},{"dia":"sábado","codigo":"ROD8"},{"dia":"domingo","codigo":"LON36"}],"14":[{"dia":"segunda","codigo":"TRO30"},{"dia":"terça","codigo":"ROD13"},{"dia":"quinta","codigo":"FAR12-1KMX1KM"},{"dia":"sábado","codigo":"ROD12"},{"dia":"domingo","codigo":"ROD15"}],"15":[{"dia":"segunda","codigo":"RIT14KM"},{"dia":"terça","codigo":"ROD10"},{"dia":"quinta","codigo":"FAR10-1KMX1KM"},{"dia":"sábado","codigo":"ROD7"},{"dia":"domingo","codigo":"LON17"}],"16":[{"dia":"segunda","codigo":"TRO60"},{"dia":"terça","codigo":"ROD10"},{"dia":"quinta","codigo":"ROD12"},{"dia":"sábado","codigo":"TRO40"},{"dia":"domingo","codigo":"MARAT"}]}};

function gerarTreinoFallback(email,an,tipo){
  const users=DB.get('fq_users')||{};
  if(!users[email])return;
  try{
    const p=RD_perfil(an||{},email);
    const planoAtual=users[email].aiPlan||{};
    const novoPlano={...planoAtual};
    if(!tipo||tipo==='gym') novoPlano.gym=RD_gerarGym(p);
    if(!tipo||tipo==='run'){
      novoPlano.run=RD_gerarRun(p);
      // Marca quando o plano de corrida começou — é a partir daqui que as
      // semanas seguintes vão liberando (1 por semana real)
      if(!users[email].runInicio) users[email].runInicio=new Date().toISOString();
    }
    users[email].aiPlan=novoPlano;
    users[email].fcMax=p.fcMax;
    users[email].motorRD=true; // marca que veio do Motor Rennan Dias
    users[email].trainApproved=true;
    DB.set('fq_users',users);
    if(typeof sb!=='undefined'&&sb&&typeof syncU==='function')syncU(users[email]).catch(()=>{});
  }catch(e){
    console.error('Motor RD erro:',e);
    // Último recurso: plano padrão do app
    const planoAtual=users[email].aiPlan||{};
    const novoPlano={...planoAtual};
    if(!tipo||tipo==='gym') novoPlano.gym=DG;
    if(!tipo||tipo==='run') novoPlano.run=DR;
    users[email].aiPlan=novoPlano;
    users[email].trainApproved=true;
    DB.set('fq_users',users);
  }
}

async function genAI(email,an){

  // ══ VARIÁVEIS CALCULADAS ══
  const diasNum=parseInt((an.dias||'3x').replace(/\D/g,''))||3;
  const nivel=an.tempo||'Iniciante';
  const isInic=nivel.includes('Iniciante')||nivel.includes('menos de 3')||nivel.includes('1 a 6');
  const isInter=nivel.includes('Intermediário')||nivel.includes('6 meses')||nivel.includes('1 ano');
  const isAvanc=nivel.includes('Avançado')||nivel.includes('2 anos')||nivel.includes('mais de');
  const objetivos=(an.obj||[]).join(', ');
  const metaCorr=(an.mc||[]).join(', ');
  const foco=(an.foco||[]).join(', ');
  const peso=parseFloat(an.peso)||75;
  const altura=parseFloat(an.altura)||170;
  const imc=(peso/Math.pow(altura/100,2)).toFixed(1);
  const temCorr=metaCorr&&metaCorr!=='Não pratica corrida'&&metaCorr.trim()!=='';
  const temJoelho=an.temJoelho,temLombar=an.temLombar,temOmbro=an.temOmbro;
  const exList=EXERCISE_BANK.map(e=>`${e.id}:${e.name}(${e.muscle})`).join(', ');

  // ══ FC MÁXIMA (Tanaka) ══
  const idade=an.nasc?Math.floor((Date.now()-new Date(an.nasc))/(365.25*24*3600*1000)):30;
  const fcMax=Math.round(208-0.7*idade);
  const z1=`${Math.round(fcMax*0.60)}-${Math.round(fcMax*0.70)}bpm`;
  const z2=`${Math.round(fcMax*0.70)}-${Math.round(fcMax*0.80)}bpm`;
  const z3=`${Math.round(fcMax*0.80)}-${Math.round(fcMax*0.87)}bpm`;
  const z4=`${Math.round(fcMax*0.87)}-${Math.round(fcMax*0.93)}bpm`;
  const z5=`${Math.round(fcMax*0.93)}-${fcMax}bpm`;
  const paceFacil=isInic?'8:30':isInter?'7:15':'6:15';
  const paceBase=isInic?'7:30':isInter?'6:15':'5:30';
  const paceRitmo=isInic?'7:00':isInter?'5:50':'5:05';
  const paceTiro=isInic?'6:20':isInter?'5:20':'4:45';

  // ══ DIVISÃO POR DIAS + OBJETIVO + NÍVEL ══
  const hiper=objetivos.includes('Hipertrofia')||objetivos.includes('massa');
  const emagrec=objetivos.includes('Emagrecimento')||objetivos.includes('gordura');
  const forca=objetivos.includes('Força')||objetivos.includes('força');

  let divisao='';
  if(diasNum<=2)divisao=`FULL BODY 2x (dias alternados obrigatório — ex: Seg/Qui ou Ter/Sex)
• 5-6 exercícios por sessão cobrindo todos os padrões: empurrar, puxar, agachar, dobrar, core
• 3 séries × 12-15 reps | Descanso 75-90s | RPE 6-7`;
  else if(diasNum===3&&isInic)divisao=`FULL BODY 3x (Seg/Qua/Sex)
• Cada sessão: 1 exercício por padrão de movimento
• 5-6 exercícios × 3 séries × 12-15 reps | RPE 6-7
• Prioridade: TÉCNICA > CARGA. Progressão: +1 rep/semana antes de aumentar carga`;
  else if(diasNum===3)divisao=`PUSH / PULL / LEGS 3x
• Dia Push (Seg): Peito + Ombro Anterior + Tríceps — compostos PRIMEIRO
• Dia Pull (Qua): Costas (vertical+horizontal) + Bíceps + Ombro Posterior
• Dia Legs (Sex): Quad + Posterior + Glúteo + Panturrilha
• 4-5 exercícios/grupo | 3-4 séries | RPE 7-9 | Descanso 60-90s`;
  else if(diasNum===4)divisao=`UPPER / LOWER 4x (Seg/Ter/Qui/Sex)
• Upper A (Seg): Peito + Costas horizontal + Bíceps + Tríceps
• Lower A (Ter): Quad dominante (agachar, leg press) + Panturrilha + Core
• Upper B (Qui): Ombro + Costas vertical (puxada) + Bíceps + Tríceps
• Lower B (Sex): Posterior dominante (stiff, mesa) + Glúteo + Core
• Frequência 2x/semana por músculo — IDEAL para hipertrofia e força`;
  else if(diasNum===5)divisao=`PPL 5 DIAS (frequência 2x/semana em todos os grupos)
• Push A (Seg): Peito inclinado + Ombro medial + Tríceps
• Pull A (Ter): Costas vertical + Bíceps + Ombro posterior
• Legs (Qua): Quad + Posterior + Glúteo + Panturrilha
• Push B (Qui): Peito plano + Tríceps
• Pull B (Sex): Costas horizontal + Bíceps
• Volume: 16-20 séries/músculo/semana`;
  else divisao=`ABCDE 6x (APENAS para avançados com histórico consistente)
• A (Seg): Peito + Ombro anterior | B (Ter): Costas + Bíceps | C (Qua): Pernas
• D (Qui): Ombro medial/posterior + Tríceps | E (Sex): Posterior + Core + Panturrilha
• Sáb: recuperação ativa (mobilidade, alongamento)`;

  // ══ METODOLOGIA POR OBJETIVO ══
  let metodologia='';
  if(hiper)metodologia=`METODOLOGIA HIPERTROFIA — PERIODIZAÇÃO POR BLOCOS (Schoenfeld 2024 + NSCA)

BLOCO 1 — Semanas 1-2: ADAPTAÇÃO NEURAL
Reps 12-15 | Séries 3 | Descanso 75-90s | RPE 6-7 | Carga 40-55% 1RM
Foco: excêntrico controlado 3s em TODOS os exercícios
Exercícios estáveis: halteres e máquinas preferidos à barra

BLOCO 2 — Semanas 3-4: ACUMULAÇÃO (Semana 4 = DELOAD)
Reps 10-12 | Séries 3-4 | Descanso 60-75s | RPE 7-8 | Carga 55-70% 1RM
Volume +10-15% vs semana anterior
Semana 4 DELOAD: -40% volume, -30% carga, RPE max 6, mesmos exercícios

BLOCO 3 — Semanas 5-6: INTENSIFICAÇÃO
Reps 8-10 compostos / 12-15 isolados | Séries 4 | Descanso 75-90s | RPE 8-9 | Carga 65-80% 1RM
Mudar variação: se usou haltere → barra, se usou inclinado → plano
Pausa 2s no estiramento máximo nos compostos

BLOCO 4 — Semana 7: REALIZAÇÃO (se intermediário/avançado)
Reps 8-10 | Séries 4-5 | RPE 9-10 | Carga 75-85% 1RM
DROP-SET na última série de cada exercício ISOLADO (-25% carga sem pausa)
REST-PAUSE nos compostos (falha → 15s pausa → mais 3-5 reps)

SEMANA 8 — DELOAD FINAL
-40% volume, -30% carga, RPE max 6, obs: "Semana de supercompensação — deixe o corpo absorver os ganhos"`;

  else if(emagrec)metodologia=`METODOLOGIA EMAGRECIMENTO — TREINO METABÓLICO PERIODIZADO

ESTRUTURA BASE: Supersets antagonistas + densidade crescente
Reps 15-20 membros inferiores | 12-15 superiores
Descanso 30-45s em supersets | 60s entre circuitos

BLOCOS:
Sem 1-2 (Adaptação): 3 séries, descanso normal 60s, aprender os movimentos
Sem 3-4 (Densidade): supersets antagonistas, descanso 30-45s — Sem4: deload
Sem 5-6 (Pico): supersets + HIIT 10min ao final (8x 30s/15s)
Sem 7 (Choque): 5 exercícios × 4 circuitos, descanso mínimo
Sem 8: DELOAD ativo

Progressão: DENSIDADE (mais repetições no mesmo tempo) antes de aumentar carga`;

  else if(forca)metodologia=`METODOLOGIA FORÇA — 5/3/1 WENDLER ADAPTADA

EXERCÍCIO PRINCIPAL por sessão (feito PRIMEIRO, sempre):
Agachamento / Supino / Stiff ou Terra / Desenvolvimento

ESQUEMA POR SEMANA (ciclo de 4 semanas):
Sem 1: 3×8-10 @ 60-70% 1RM | RPE 7 | Descanso 2-3min
Sem 2: 3×6-8 @ 70-80% 1RM | RPE 8 | Descanso 2-3min
Sem 3: 3×4-6 @ 80-90% 1RM | RPE 9 | Descanso 3min
Sem 4: DELOAD 3×10 @ 50% 1RM | RPE 5 | Foco em técnica perfeita
Sem 5-8: REPETIR com carga 5% maior

ACESSÓRIOS: 3-4 exercícios × 3 séries × 8-12 reps | RPE 7-8
Aquecimento obrigatório antes do pesado: 2 sets (50% e 75% da carga)`;

  else metodologia=`METODOLOGIA SAÚDE — PERIODIZAÇÃO ONDULANTE DIÁRIA (DUP)

Evidência: DUP gerou 19% mais ganhos com 22% menos volume (JSCR 2024)
Variação de estímulo dentro da semana:
• Dia de Força (1° treino/sem): 4-6 reps | carga alta | descanso 2-3min
• Dia de Hipertrofia (2° treino/sem): 10-12 reps | carga moderada | descanso 75s
• Dia de Resistência (3° treino/sem): 15-20 reps | carga leve | descanso 45s
Cardio moderado 15-20min ao final: FC Zona 2 (${z2})`;

  // ══ CORRIDA ══
  let metodoCorr='';
  if(temCorr){
    const dist5k=metaCorr.includes('5k')||metaCorr.includes('5km');
    const dist10k=metaCorr.includes('10k')||metaCorr.includes('10km');
    const dist21k=metaCorr.includes('21')||metaCorr.includes('meia');
    metodoCorr=`
══ CORRIDA — METODOLOGIA CIENTÍFICA ══
FC Máxima: ${fcMax}bpm | Fórmula Tanaka (208 - 0.7×${idade} anos)
ZONAS DE TREINO CALCULADAS:
Z1 Recuperação: ${z1} | Z2 Base aeróbica: ${z2} | Z3 Limiar: ${z3} | Z4 Anaeróbico: ${z4} | Z5 Máximo: ${z5}

PACES PRESCRITOS para este aluno:
Regenerativo/Fácil: ${paceFacil}/km | Base: ${paceBase}/km | Ritmo/Tempo: ${paceRitmo}/km | Tiro/Intervalado: ${paceTiro}/km

TIPOS DE SESSÃO (use conforme estrutura semanal):
• Regenerativo (R): Z1, muito leve, conversação confortável — recuperação
• Leve/Base (L): Z2, consegue falar frases completas — base aeróbica (60-70% do volume)
• Progressivo (P): começa Z2 termina Z3, treina controle de pace
• Tempo Run (T): Z3 sustentado 20-40min, eleva limiar anaeróbico
• Intervalado (I): ${isInic?`6×1min rápido (Z4-${z4}) + 2min trotando`:isInter?`8×400m (${paceRitmo}/km, Z4) + 200m trotando`:`5×1000m (${paceTiro}/km, Z4-Z5) + 400m trotando`}
• Fartlek (F): variações livres de ritmo em corrida leve — percepção
• Longão (LG): longo e DEVAGAR Z1-Z2 — resistência aeróbica (nunca >10% aumento/semana)

META: ${metaCorr} | Estrutura 8 semanas:
${dist5k?'5K: Sem1-2→12-15km (L+I básico+L) | Sem3-4→15-18km (P+I+LG) | Sem4 deload | Sem5-6→18-22km (T+I+L+LG) | Sem7→20-24km (I pico+P) | Sem8→2x leve+teste':''}
${dist10k?'10K: Sem1-2→18-22km (L+I+LG) | Sem3-4→22-28km (L+T+I+LG) | Sem4 deload | Sem5-6→28-35km (T+I+P+LG) | Sem7→25-30km (I pico+T+R) | Sem8→2x leve+prova':''}
${dist21k?'MEIA: Sem1-2→28-35km (L+I+T+LG14km) | Sem3-4→35-42km (+LG16km) | Sem4 deload | Sem5-6→42-50km (+LG18km) | Sem7→35-40km tapering | Sem8→descanso+prova':''}

REGRAS CORRIDA:
• 80/20: 80% volume leve (Z1-Z2) / 20% intenso (Z3-Z5)
• NUNCA aumentar distância total >10%/semana
• Deload semanas 4 e 8: -30% volume
• Tip: sempre mencionar a meta específica (${metaCorr}), pace calculado e zone FC
${temJoelho?'• JOELHO: nas primeiras 2 semanas máximo caminhada+trote leve. Piso macio. Sem descidas íngremes.':''}`;
  }

  const prompt=`Você é o Personal Trainer Rennan Dias — especialista em periodização científica (NSCA, ACSM, ISSN) com foco em musculação e corrida de rua.

Seu estilo: treinos INDIVIDUALIZADOS e VARIADOS. Cada aluno recebe um programa único, com exercícios que mudam semana a semana, dicas técnicas específicas e progressão real.

══════════ FICHA DO ALUNO ══════════
${an.sexo} | ${peso}kg | ${altura}cm | IMC ${imc} | ${idade} anos
Nível: ${nivel} | Dias/semana: ${an.dias} | Duração: ${an.dur||'60min'} | Local: ${an.local||'Academia'}
Objetivo: ${objetivos||'Saúde geral'} | Foco muscular: ${foco||'Corpo todo'}
Corrida: ${metaCorr||'Não pratica'} | Prazo: ${an.prazo||'Sem prazo definido'}
Profissão: ${an.prof||'?'} | Atividade laboral: ${an.atvTrab||'?'}
Biótipo: ${an.biotipo||'?'} | Gordura: ${an.gordura||'?'}
Sono: ${an.sono||'?'}h | Estresse: ${an.stress||'?'} | Alimentação: ${an.alim||'?'}
Suplementação: ${(an.supl||[]).join(', ')||'Nenhuma'}
Lesões: ${(an.lesoes||[]).join(', ')||'Nenhuma'} | Dor ${an.dorInt||'0'}/10
Motivação pessoal: "${an.motiv||'?'}"

⚠️ RESTRIÇÕES DE SEGURANÇA — PRIORIDADE MÁXIMA:
JOELHO: ${temJoelho?'🚫 PROIBIDO: agachamento profundo, cadeira extensora (e023), leg press>90°, avanço fundo, corrida contínua de impacto. OBRIGATÓRIO: hip thrust (e027), adutora (e046), isométrico quad (e033), step (e037), leg press parcial 0-60° (e038), glúteo médio (e035)':'✅ Livre'}
LOMBAR: ${temLombar?'🚫 PROIBIDO: peso axial pesado, remada curvada carga alta (e005), stiff pesado (e021), sit-up, hiperextensão. OBRIGATÓRIO: prancha (e029), dead bug (e040), remada máquina (e030), hip thrust (e027)':'✅ Livre'}
OMBRO: ${temOmbro?'🚫 PROIBIDO: desenvolvimento livre (e009/e010), elevação frontal>90° (e012), remada alta, supino pega larga. OBRIGATÓRIO: rotação ext (e044), face pull (e049), puxada neutra (e006), remada baixa (e030)':'✅ Livre'}

══════════ METODOLOGIA ══════════
DIVISÃO PRESCRITA: ${divisao}

${metodologia}
${metodoCorr}

BANCO DE EXERCÍCIOS (use SOMENTE estes IDs):
${exList}

══════════ REGRAS DE EXECUÇÃO ══════════
1. VARIAÇÃO OBRIGATÓRIA entre semanas (anti-adaptação):
   Sem 1-2: máquina/haltere (estável, aprendizado) | Sem 3-4: barra (livre) | Sem 5-6: ângulo/pega diferente | Sem 7: técnicas avançadas | Sem 8: deload
2. NUNCA mesmo exercício no mesmo músculo semanas consecutivas sem mudar algo (ângulo, equipamento, amplitude)
3. Compostos SEMPRE antes de isolados no mesmo treino
4. OBS — dica técnica ESPECÍFICA e ÚNICA por exercício:
   ✅ BOM: "Descida 3s, pausa 1s no peito, cotovelos 45° do tronco"
   ✅ BOM: "Quadril como eixo, costas neutras, sinta o estiramento isquiotibiais"
   ❌ RUIM: "Execute com controle" (genérico)
5. LOAD específico: "Leve (40-50% 1RM)", "Moderada (55-65% 1RM)", "Moderada-Alta (65-75% 1RM)", "Alta (75-85% 1RM)"
6. Fases devem ser motivacionais e descritivas: "Adaptação Neural — Construindo a Base", "Intensificação — Superando Limites"
7. CORRIDA tip: mencionar sempre a meta (${metaCorr||'condicionamento'}), pace calculado e zona FC

══════════ OUTPUT JSON ══════════
Retorne SOMENTE JSON válido. Zero markdown. Zero texto fora do JSON.
A estrutura dos treinos DEVE refletir a divisão prescrita acima (não usar sempre ABC).
Sessões de corrida: incluir campo "estrutura" com divisão do treino (aquecimento/principal/desaceleração).

{"gym":{"Semana 1":{"fase":"[fase motivacional]","days":{"[Nome exato do treino]":[{"id":"e001","sets":3,"reps":"12","load":"Leve (40-50% 1RM)","rest":90,"obs":"dica técnica específica"}]}},"Semana 2":{...},"Semana 3":{...},"Semana 4":{"fase":"⚡ DELOAD — Recuperação Ativa",...},"Semana 5":{...},"Semana 6":{...},"Semana 7":{...},"Semana 8":{"fase":"⚡ DELOAD — Supercompensação Final",...}},"run":{"Semana 1":{"meta":"[objetivo da semana]","sessions":[{"day":"Ter","type":"Leve (Base Aeróbica)","dist":"5 km","pace":"${paceBase}/km","fc":"Z2 (${z2})","dur":"~38 min","estrutura":"Aquecimento 5min caminhada → 28min Z2 → 5min desaceleração","tip":"[dica personalizada com meta e pace]"}]}}}`;

  const _ctrl=new AbortController();
  const _tmo=setTimeout(()=>_ctrl.abort(),45000); // timeout 45s — nunca trava para sempre
  let res;
  try{
    const _aiUrl=AI_PROXY_URL||'https://api.anthropic.com/v1/messages';
    res=await fetch(_aiUrl,{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-6',max_tokens:8000,messages:[{role:'user',content:prompt}]}),
      signal:_ctrl.signal
    });
  }finally{clearTimeout(_tmo);}
  if(!res.ok){const err=await res.json().catch(()=>({}));throw new Error(`API ${res.status}: ${err.error?.message||'error'}`);}
  const data=await res.json();
  let raw=data.content.map(i=>i.text||'').join('').trim();
  raw=raw.replace(/```json/gi,'').replace(/```/g,'').trim();
  const fb=raw.indexOf('{'),lb=raw.lastIndexOf('}');
  if(fb>=0&&lb>fb)raw=raw.substring(fb,lb+1);
  let plan;
  try{plan=JSON.parse(raw);}catch(e){console.error('Parse error:',e.message,'Raw:',raw.substring(0,300));throw new Error('Resposta incompleta, tentando novamente...');}
  if(!plan||!plan.gym)throw new Error('Plano incompleto, tentando novamente...');
  const users=DB.get('fq_users')||{};
  if(users[email]){
    users[email].aiPlan=plan;users[email].trainApproved=true;
    users[email].fcMax=fcMax;users[email].paceBase=paceBase;
    DB.set('fq_users',users);await syncU(users[email]);
  }
}


// ══ TIMER ══
let timerInt=null;let timerSec=0;let timerTotal=0;
function startTimer(s){clearInterval(timerInt);timerSec=s;timerTotal=s;document.getElementById('timer-display').textContent=s;updTmr(s,s);abrirModal('modal-timer');timerInt=setInterval(()=>{timerSec--;document.getElementById('timer-display').textContent=timerSec;updTmr(timerSec,timerTotal);if(timerSec<=0){clearInterval(timerInt);document.getElementById('modal-timer').classList.remove('open');}},1000);}
function updTmr(c,t){const pct=Math.round((c/t)*100);const r=document.getElementById('tmr-ring');if(r)r.style.setProperty('--pct',pct+'%');}
function skipTimer(){clearInterval(timerInt);document.getElementById('modal-timer').classList.remove('open');}
function addTime(s){timerSec+=s;document.getElementById('timer-display').textContent=timerSec;}

// ══ NOMES DOS EXERCÍCIOS EM INGLÊS ══
// O campo .name do banco fica SEMPRE em português, porque o motor usa ele
// pra detectar exercícios compostos, pliometria e contraindicações por lesão.
// Este mapa é só pra EXIBIÇÃO — traduzir o .name quebraria a lógica.
const EXERCISE_NAME_EN = {"e001":"Flat Bench Press","e002":"Incline Bench Press","e003":"Dumbbell Fly","e004":"Pec Deck","e005":"Bent-Over Row","e006":"Lat Pulldown","e007":"Single-Arm Row","e008":"Pullover","e009":"Barbell Overhead Press","e010":"Dumbbell Shoulder Press","e011":"Lateral Raise","e012":"Front Raise","e013":"Barbell Curl","e014":"Alternating Curl","e015":"Preacher Curl","e016":"Cable Triceps Pushdown","e017":"Skull Crusher","e018":"Overhead Triceps Extension","e019":"Barbell Squat","e020":"Leg Press 45°","e021":"Stiff-Leg Deadlift","e022":"Forward Lunge","e023":"Leg Extension","e024":"Lying Leg Curl","e025":"Standing Calf Raise","e026":"Hack Squat","e027":"Hip Thrust","e028":"Crunch","e029":"Plank","e030":"Seated Cable Row","e031":"Single-Leg Hip Thrust","e032":"Sumo Squat","e033":"Quad Isometric Hold","e034":"Straight-Leg Raise","e035":"Banded Hip Abduction","e036":"Wall Sit","e037":"Step Up","e038":"Partial-Range Leg Press","e039":"Side Plank","e040":"Dead Bug","e041":"Superman","e042":"Dumbbell Bench Row","e043":"Seated Dumbbell Press","e044":"Shoulder External Rotation","e045":"Hammer Curl","e046":"Hip Adduction Machine","e047":"Quadruped Hip Extension","e048":"Goblet Squat","e049":"T-Bar Row (Chest-Supported)","e050":"Bench Dips","e051":"Decline Bench Press","e052":"Machine Bench Press","e053":"High Cable Crossover","e054":"Low Cable Crossover","e055":"Push-Up","e056":"Incline Push-Up","e057":"Pull-Up","e058":"Chin-Up","e059":"Close-Grip Pulldown","e060":"T-Bar Row","e061":"Hammer Strength Row","e062":"Shrug","e063":"Face Pull","e064":"Reverse Fly","e065":"Reverse Fly Machine","e066":"Arnold Press","e067":"Cable Lateral Raise","e068":"Incline Lateral Raise","e069":"Wide-Grip Upright Row","e070":"Concentration Curl","e071":"21s Curl","e072":"Cable Curl","e073":"Reverse Curl","e074":"Rope Triceps Pushdown","e075":"Triceps Kickback","e076":"Single-Arm Cable Triceps","e077":"Close-Grip Bench Press","e078":"Front Squat","e079":"Bulgarian Split Squat","e080":"Sissy Squat","e081":"Single-Leg Press","e082":"Walking Lunge","e083":"Seated Leg Curl","e084":"Single-Leg Stiff Deadlift","e086":"Hip Thrust Machine","e087":"Cable Glute Kickback","e088":"Cable Abduction","e089":"Donkey Calf Raise","e090":"Single-Leg Calf Raise","e091":"Hanging Knee Raise (Parallel Bars)","e092":"Ab Machine","e093":"Cable Crunch","e094":"Russian Twist","e095":"Ab Wheel Rollout","e096":"Mountain Climber","e097":"Burpee","e098":"Kettlebell Swing","e099":"Farmer Walk","e100":"Deadlift","e101":"Sumo Deadlift","e102":"Underhand Bent-Over Row","e103":"Cable Pullover","e104":"Smith Machine Calf Raise","e105":"Plank with Leg Lift","e106":"Kettlebell Goblet Squat","e107":"Turkish Get-Up","e108":"Kettlebell Clean","e109":"Kettlebell Snatch","e110":"Thruster","e111":"Wall Ball","e112":"Slam Ball","e113":"Battle Rope","e114":"Sled Push","e115":"Sled Pull","e116":"Box Jump","e117":"Squat Jump","e118":"Broad Jump","e119":"Skater Jump","e120":"Plyo Push-Up","e121":"Bear Crawl","e122":"Crab Walk","e123":"Bear to Plank","e124":"Bulgarian Split Squat Jump","e125":"Pistol Squat","e126":"High-Knee Step-Up","e127":"Reverse Lunge","e128":"Lateral Lunge","e129":"Cossack Squat","e130":"Single-Leg Glute Bridge","e131":"Nordic Curl","e132":"Copenhagen Plank","e133":"Plank Shoulder Tap","e134":"Pallof Press","e136":"Bird Dog","e137":"Hollow Body Hold","e138":"Up-Down Plank","e139":"Windshield Wiper","e141":"Toes to Bar","e142":"L-Sit","e143":"Burpee Box Jump","e144":"Jumping Jack","e145":"High-Knee Running in Place","e146":"Jump Rope","e147":"Treadmill Sprint","e148":"HIIT on Stationary Bike","e149":"Rowing Machine","e150":"StairMaster","e151":"Elliptical","e152":"Cat-Cow","e153":"Supine Thoracic Rotation","e154":"90/90 Hip Mobility","e155":"Hip Flexor Stretch","e156":"Shoulder Dislocate with Stick","e157":"Doorway Chest Stretch","e158":"Thoracic Foam Rolling","e159":"IT Band Foam Rolling","e160":"Wall Calf Stretch","e161":"Child's Pose","e162":"Downward-Facing Dog","e163":"Mini Band Glute Activation","e164":"Clamshell","e165":"Monster Walk","e166":"Banded External Rotation","e167":"Y-T-W on Bench","e168":"Face Pull with Rotation","e169":"Scapular Push-Up","e170":"Chin Tuck","e171":"Single-Arm Farmer Walk","e172":"Rack Carry","e173":"Overhead Carry","e174":"Landmine Press","e175":"Landmine Row","e176":"Landmine Rotation","e177":"Bulgarian Split Squat Isometric","e179":"Paused Bench Press Isometric","e180":"Paused Squat","e181":"Neutral-Grip Dumbbell Press","e182":"High Pulley Crossover","e183":"Low Pulley Crossover","e184":"Diamond Push-Up","e185":"Archer Push-Up","e187":"Chest Press Machine","e188":"Chest Fly Machine","e192":"Lying Lateral Raise","e193":"Military Press","e194":"Upright Row","e195":"Reverse Pec Deck","e196":"Plate Front Raise","e197":"Pike Push-Up","e198":"Dumbbell Stiff-Leg Deadlift","e199":"Single-Leg Leg Curl","e200":"Good Morning","e201":"Barbell Hip Thrust","e202":"Glute-Ham Raise","e203":"Seated Hamstring Curl","e204":"Single-Arm Kettlebell Swing","e205":"Leg Press Calf Raise","e206":"Seated Calf Raise","e208":"Calf Hops","e210":"Spider Curl","e212":"Machine Triceps Dip","e213":"Reverse-Grip Single-Arm Triceps","e214":"Cable Hammer Curl","e215":"Neutral-Grip Pulldown","e217":"Row Machine","e218":"Straight-Arm Pulldown","e219":"Australian Pull-Up","e220":"Neutral-Grip Pull-Up","e222":"High Cable Crunch","e225":"Hanging Leg Raise","e226":"Side Plank with Hip Raise","e227":"Dumbbell Thruster","e228":"Devil Press","e229":"Man Maker","e231":"Box Jump Over","e232":"Burpee Pull-Up","e234":"Battle Rope Double Waves","e236":"Clean and Jerk"};

// Nome do exercício no idioma ativo (usar em toda exibição)
function exNome(ex){
  if(!ex) return '';
  if(fqLangAtual() === 'en' && ex.id && EXERCISE_NAME_EN[ex.id]) return EXERCISE_NAME_EN[ex.id];
  return ex.name || '';
}
// Versão por id, pra quando só o id está disponível
function exNomeId(id){
  const e = (typeof EXERCISE_BANK !== 'undefined') ? EXERCISE_BANK.find(x=>x && x.id===id) : null;
  return e ? exNome(e) : (id || '');
}

// Idioma atual — detecta do navegador na primeira visita
function fqLangAtual(){
  const salvo = localStorage.getItem('fq_lang');
  if(salvo === 'pt' || salvo === 'en') return salvo;
  const nav = (navigator.language || navigator.userLanguage || 'pt').toLowerCase();
  return nav.startsWith('pt') ? 'pt' : 'en';
}

// Tradutor. Se a chave não existir no idioma escolhido, cai no português
// (nunca mostra a chave crua nem espaço em branco pro usuário).
function t(chave, vars){
  const lang = fqLangAtual();
  let txt = (FQ_I18N[lang] && FQ_I18N[lang][chave]);
  if(txt === undefined) txt = (FQ_I18N.pt[chave] !== undefined ? FQ_I18N.pt[chave] : chave);
  if(vars){
    Object.keys(vars).forEach(k=>{ txt = txt.split('{'+k+'}').join(vars[k]); });
  }
  return txt;
}

// Troca o idioma e recarrega a interface
function fqTrocarIdioma(lang){
  if(lang !== 'pt' && lang !== 'en') return;
  localStorage.setItem('fq_lang', lang);
  location.reload();
}

// Aplica as traduções em tudo que estiver marcado com data-i18n
function aplicarIdioma(){
  const dias = (typeof TRIAL_DIAS !== 'undefined') ? TRIAL_DIAS : 14;
  document.querySelectorAll('[data-i18n]').forEach(el=>{
    const chave = el.getAttribute('data-i18n');
    el.innerHTML = t(chave, {dias});
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el=>{
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph'), {dias}));
  });
  document.documentElement.setAttribute('lang', fqLangAtual()==='en' ? 'en' : 'pt-BR');
  const sel = document.getElementById('fq-lang-switch');
  if(sel) sel.value = fqLangAtual();
}

const TRIAL_DIAS = 14;
// ══ EXERCISE IMAGES BY MUSCLE GROUP ══

// ══ GIFS DE DEMONSTRAÇÃO DOS EXERCÍCIOS ══
// Lista cresce conforme os gifs vão sendo adicionados à pasta /exercicios do repositório.
// Fallback automático pro emoji+foto quando ausente.
const EXERCICIOS_COM_GIF = new Set(['e001','e002','e003','e004','e005','e006','e007','e008','e009','e010','e011','e013','e014','e015','e016','e017','e018','e019','e020','e021','e022','e023','e024','e026','e027','e028','e030','e037','e041','e042','e045','e046','e050','e051','e052','e053','e054','e055','e056','e058','e061','e063','e075','e077','e079','e102','e113','e120','e131','e136','e144','e149','e152','e157','e174','e175','e179','e181','e182','e183','e184','e187','e188','e193','e196','e203','e217','e218','e225','e237','e238','e239','e240','e241','e242','e243','e244','e245','e246','e247','e248','e249','e250','e251','e252','e253','e254','e255','e256','e257','e258','e259','e260','e261','e262','e263','e103','e215','e059','e012','e062','e067','e194','e264','e265','e266','e267','e268','e269','e065','e195','e068','e192','e270','e271','e272','e070','e072','e214','e210','e168','e273','e064','e069','e044','e212','e076','e036','e032','e048','e129','e274','e275','e276','e277','e278','e279','e280','e281','e282','e074','e283','e284','e083','e199','e147','e148','e150','e151','e285','e286','e287','e288','e289','e290','e291','e292','e293','e098','e121','e294','e295','e296','e297','e298','e299','e057','e300','e301','e302','e303','e025','e198']);
function temGifDemo(exId){ return EXERCICIOS_COM_GIF.has(exId); }
function getExGif(exId){ return `${exId}.gif`; }
function renderExThumb(ex){
  if(temGifDemo(ex.id)){
    return `<img src="${getExGif(ex.id)}" alt="${ex.name}" loading="lazy" style="width:100%;height:100%;object-fit:contain;background:#f6f2e4"
      onerror="this.closest('.ep-thumb').innerHTML=renderExThumbFallback('${ex.id}')"/>`;
  }
  return renderExThumbFallback(ex.id);
}
function renderExThumbFallback(exId){
  const ex=getExById(exId);if(!ex)return '';
  return `<img src="${getExImg(ex.muscle)}" alt="${ex.name}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:brightness(.4)"/>
    <div style="position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:6px">
      <div style="font-size:44px;line-height:1;filter:drop-shadow(0 2px 8px rgba(0,0,0,.8))">${ex.emoji||'🏋️'}</div>
      <div style="font-size:13px;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,.8)">${ex.name}</div>
      <div style="font-size:10px;color:var(--r);font-weight:700;background:rgba(229,9,20,.15);padding:3px 10px;border-radius:4px;border:1px solid rgba(229,9,20,.3)">${ex.muscle}</div>
    </div>`;
}

function getExImg(muscle){
  const m = (muscle||'').toLowerCase();
  if(m.includes('peito'))         return 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=400&q=80';
  if(m.includes('costas'))        return 'https://images.unsplash.com/photo-1530822847156-5df684ec5933?w=400&q=80';
  if(m.includes('ombro'))         return 'https://images.unsplash.com/photo-1581009146145-b5ef050c2e1e?w=400&q=80';
  if(m.includes('bíceps')||m.includes('biceps')) return 'https://images.unsplash.com/photo-1583454110551-21f2fa2afe61?w=400&q=80';
  if(m.includes('tríceps')||m.includes('triceps')) return 'https://images.unsplash.com/photo-1599058918144-1ffabb6ab9a0?w=400&q=80';
  if(m.includes('quadr')||m.includes('perna')||m.includes('glút')||m.includes('posterior')) return 'https://images.unsplash.com/photo-1574680178050-55c6a6a96e0a?w=400&q=80';
  if(m.includes('panturrilha'))   return 'https://images.unsplash.com/photo-1434682881908-b43d0467b798?w=400&q=80';
  if(m.includes('abdôm')||m.includes('core')) return 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?w=400&q=80';
  if(m.includes('corrid')||m.includes('run')) return 'https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?w=400&q=80';
  // default
  return 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=400&q=80';
}

// ══ GYM ══
let curGymWeek='Semana 1';let curGymDay='Treino A';
// ══════════════════════════════════════════════════════════
// MEU TREINO — o aluno pode usar o plano gerado pelo app ("nosso")
// ou montar/ajustar o próprio treino ("meu"). Os dois convivem:
// trocar de modo nunca apaga o outro.
// ══════════════════════════════════════════════════════════

function getModoTreino(u){ return u.modoTreino || 'nosso'; }

function setModoTreino(modo){
  const u=getU(); if(!u) return;
  u.modoTreino=modo;
  // Ao entrar no modo próprio pela primeira vez, oferece começar do nosso plano
  if(modo==='meu' && !u.meuTreino){
    abrirEscolhaBaseTreino();
    return;
  }
  saveU(u);
  renderGym(u);
}

function atualizarBarraModo(u){
  const modo=getModoTreino(u);
  const bNosso=document.getElementById('gym-modo-nosso');
  const bMeu=document.getElementById('gym-modo-meu');
  if(!bNosso||!bMeu) return;
  const ativo='background:var(--r);color:#fff';
  const inativo='background:transparent;color:var(--t2)';
  bNosso.style.cssText=`flex:1;text-align:center;padding:12px 8px;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;transition:all .2s;${modo==='nosso'?ativo:inativo}`;
  bMeu.style.cssText=`flex:1;text-align:center;padding:12px 8px;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;transition:all .2s;${modo==='meu'?ativo:inativo}`;
}

function abrirEscolhaBaseTreino(){
  abrirModal('modal-base-treino');
}

function criarMeuTreino(base){
  const u=getU(); if(!u) return;
  closeModal('modal-base-treino');

  if(base==='copiar'){
    // Parte do plano atual gerado pelo app
    const P=getGP(u);
    const semana=P['Semana '+(u.gymWeek||1)]||P[Object.keys(P)[0]];
    const dias={};
    if(semana&&semana.days){
      Object.entries(semana.days).forEach(([nomeDia,exs])=>{
        dias[nomeDia]=exs.map(ex=>{
          const info=EXERCISE_BANK.find(e=>e.id===ex.id);
          return {id:ex.id, nome:info?exNome(info):'Exercise', sets:ex.sets, reps:ex.reps, rest:ex.rest||60, custom:false};
        });
      });
    }
    u.meuTreino={dias, criadoEm:new Date().toISOString()};
  }else{
    // Do zero — começa com um dia vazio
    u.meuTreino={dias:{'Treino A':[]}, criadoEm:new Date().toISOString()};
  }
  u.modoTreino='meu';
  saveU(u);
  fqToast(base==='copiar'?'✅ Treino copiado! Agora é só ajustar.':'✅ Treino criado! Adicione seus exercícios.','ok');
  renderGym(u);
}

let MT_DIA_ATUAL=null;

function renderMeuTreino(u){
  const mt=u.meuTreino;
  const elEx=document.getElementById('gym-exercises');
  const elDias=document.getElementById('gym-day-btns');
  const elSemanas=document.getElementById('gym-wtabs');
  const elBtn=document.getElementById('gym-complete-btn');
  if(elSemanas) elSemanas.innerHTML='';

  if(!mt||!mt.dias||!Object.keys(mt.dias).length){
    if(elDias) elDias.innerHTML='';
    elEx.innerHTML=`<div style="text-align:center;padding:34px 20px">
      <div style="font-size:46px;margin-bottom:14px">✏️</div>
      <div style="font-size:15px;font-weight:800;margin-bottom:6px">Monte seu treino</div>
      <div style="font-size:12.5px;color:var(--t2);line-height:1.6;margin-bottom:18px">Escolha exercícios da nossa lista ou adicione os seus.</div>
      <button class="btn-p" onclick="abrirEscolhaBaseTreino()">Começar</button>
    </div>`;
    if(elBtn) elBtn.innerHTML='';
    return;
  }

  const nomesDias=Object.keys(mt.dias);
  if(!MT_DIA_ATUAL||!mt.dias[MT_DIA_ATUAL]) MT_DIA_ATUAL=nomesDias[0];

  elDias.innerHTML=nomesDias.map(d=>
    `<button class="day-btn ${d===MT_DIA_ATUAL?'active':''}" onclick="MT_DIA_ATUAL='${d.replace(/'/g,"")}';renderGym(getU())">${d}</button>`
  ).join('')+`<button class="day-btn" onclick="mtAddDia()" style="background:rgba(46,204,113,.1);color:#2ecc71;border-color:rgba(46,204,113,.3)">+ Dia</button>`;

  const exs=mt.dias[MT_DIA_ATUAL]||[];
  elEx.innerHTML=`
    ${exs.length?exs.map((ex,i)=>`
      <div style="background:var(--s);border:1px solid var(--b);border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <div style="display:flex;flex-direction:column;gap:2px;flex-shrink:0">
            <button onclick="mtMoverEx(${i},-1)" ${i===0?'disabled':''} style="background:${i===0?'rgba(255,255,255,.03)':'rgba(255,255,255,.08)'};border:1px solid var(--b);color:${i===0?'var(--mu)':'#fff'};border-radius:5px;width:26px;height:20px;font-size:11px;cursor:${i===0?'default':'pointer'};line-height:1;padding:0" title="Mover para cima">▲</button>
            <button onclick="mtMoverEx(${i},1)" ${i===exs.length-1?'disabled':''} style="background:${i===exs.length-1?'rgba(255,255,255,.03)':'rgba(255,255,255,.08)'};border:1px solid var(--b);color:${i===exs.length-1?'var(--mu)':'#fff'};border-radius:5px;width:26px;height:20px;font-size:11px;cursor:${i===exs.length-1?'default':'pointer'};line-height:1;padding:0" title="Mover para baixo">▼</button>
          </div>
          <div style="background:var(--r);color:#fff;border-radius:6px;min-width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0">${i+1}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${ex.nome}</div>
            ${ex.custom?'<div style="font-size:9px;color:#f39c12;font-weight:700">✏️ SEU EXERCÍCIO</div>':''}
          </div>
          <button onclick="mtRemoverEx(${i})" style="background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.25);color:var(--r);border-radius:6px;width:28px;height:28px;font-size:14px;cursor:pointer;flex-shrink:0">✕</button>
        </div>
        <div style="display:flex;gap:6px">
          <div style="flex:1"><div style="font-size:9px;color:var(--mu);margin-bottom:3px;font-weight:700">SÉRIES</div>
            <input type="number" value="${ex.sets}" min="1" max="10" onchange="mtEditarEx(${i},'sets',this.value)" class="fi" style="padding:7px;font-size:12px;text-align:center"/></div>
          <div style="flex:1"><div style="font-size:9px;color:var(--mu);margin-bottom:3px;font-weight:700">REPS</div>
            <input type="text" value="${ex.reps}" onchange="mtEditarEx(${i},'reps',this.value)" class="fi" style="padding:7px;font-size:12px;text-align:center"/></div>
          <div style="flex:1"><div style="font-size:9px;color:var(--mu);margin-bottom:3px;font-weight:700">DESC (s)</div>
            <input type="number" value="${ex.rest}" min="0" max="300" step="15" onchange="mtEditarEx(${i},'rest',this.value)" class="fi" style="padding:7px;font-size:12px;text-align:center"/></div>
        </div>
      </div>`).join('')
      :'<div style="text-align:center;color:var(--mu);padding:26px;font-size:12px">Nenhum exercício neste dia ainda</div>'}
    <button class="btn-p" style="margin-top:6px;background:rgba(46,204,113,.12);color:#2ecc71;border:1px solid rgba(46,204,113,.3)" onclick="abrirAddExercicio()">+ Adicionar Exercício</button>
    ${nomesDias.length>1?`<button onclick="mtRemoverDia()" style="width:100%;margin-top:8px;background:none;border:none;color:var(--mu);font-size:11px;cursor:pointer;padding:8px">Remover dia "${MT_DIA_ATUAL}"</button>`:''}
  `;

  if(elBtn) elBtn.innerHTML = exs.length
    ? `<button class="btn-p" style="margin-top:10px" onclick="concluirTreinoProprio()">✅ Concluir Treino de Hoje</button>`
    : '';
}

function mtAddDia(){
  const u=getU(); if(!u||!u.meuTreino) return;
  const n=Object.keys(u.meuTreino.dias).length;
  const nome='Treino '+String.fromCharCode(65+n); // A, B, C...
  u.meuTreino.dias[nome]=[];
  MT_DIA_ATUAL=nome;
  saveU(u); renderGym(u);
}

function mtRemoverDia(){
  const u=getU(); if(!u||!u.meuTreino) return;
  const nomes=Object.keys(u.meuTreino.dias);
  if(nomes.length<=1){ fqToast('Você precisa ter pelo menos um dia.','warn'); return; }
  delete u.meuTreino.dias[MT_DIA_ATUAL];
  MT_DIA_ATUAL=Object.keys(u.meuTreino.dias)[0];
  saveU(u); renderGym(u);
  fqToast('Dia removido.','ok');
}

function mtEditarEx(idx,campo,valor){
  const u=getU(); if(!u||!u.meuTreino) return;
  const exs=u.meuTreino.dias[MT_DIA_ATUAL];
  if(!exs||!exs[idx]) return;
  if(campo==='sets'||campo==='rest'){
    const n=parseInt(valor);
    exs[idx][campo]=isNaN(n)?exs[idx][campo]:Math.max(campo==='rest'?0:1,n);
  }else{
    exs[idx][campo]=sanitizeStr(valor,20);
  }
  saveU(u);
}

// Move um exercício do "Meu Treino" para cima (-1) ou para baixo (+1) na ordem
function mtMoverEx(idx, direcao){
  const u=getU(); if(!u||!u.meuTreino) return;
  const lista=u.meuTreino.dias[MT_DIA_ATUAL];
  if(!lista) return;
  const novo=idx+direcao;
  if(novo<0 || novo>=lista.length) return; // já está no topo/fim
  [lista[idx], lista[novo]] = [lista[novo], lista[idx]];
  saveU(u);
  renderGym(u);
}

function mtRemoverEx(idx){
  const u=getU(); if(!u||!u.meuTreino) return;
  const exs=u.meuTreino.dias[MT_DIA_ATUAL];
  if(!exs) return;
  exs.splice(idx,1);
  saveU(u); renderGym(u);
}

function abrirAddExercicio(){
  document.getElementById('add-ex-busca').value='';
  document.getElementById('add-ex-custom').value='';
  renderListaAddEx('');
  abrirModal('modal-add-ex');
}

function renderListaAddEx(termo){
  const t=(termo||'').toLowerCase();
  const filtrados=EXERCISE_BANK.filter(e=>!t||e.name.toLowerCase().includes(t)||(e.muscle||'').toLowerCase().includes(t)).slice(0,40);
  document.getElementById('add-ex-lista').innerHTML=filtrados.length?filtrados.map(e=>
    `<div onclick="mtAddExDoBanco('${e.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer">
      <div style="font-size:18px">${e.emoji||'🏋️'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12.5px;font-weight:700">${exNome(e)}</div>
        <div style="font-size:10px;color:var(--mu)">${e.muscle} · ${e.equipment}</div>
      </div>
      <div style="color:var(--r);font-size:16px">+</div>
    </div>`).join('')
    :'<div style="text-align:center;color:var(--mu);padding:22px;font-size:12px">Nenhum exercício encontrado.<br>Use o campo abaixo para adicionar o seu.</div>';
}

function mtAddExDoBanco(id){
  const u=getU(); if(!u||!u.meuTreino) return;
  const info=EXERCISE_BANK.find(e=>e.id===id);
  if(!info) return;
  if(!u.meuTreino.dias[MT_DIA_ATUAL]) u.meuTreino.dias[MT_DIA_ATUAL]=[];
  u.meuTreino.dias[MT_DIA_ATUAL].push({id, nome:exNome(info), sets:3, reps:'12', rest:60, custom:false});
  saveU(u);
  closeModal('modal-add-ex');
  renderGym(u);
  fqToast('✅ '+info.name+' adicionado','ok');
}

function mtAddExCustom(){
  const u=getU(); if(!u||!u.meuTreino) return;
  const nome=sanitizeStr(document.getElementById('add-ex-custom').value,60);
  if(!nome){ fqToast('Digite o nome do exercício.','warn'); return; }
  if(!u.meuTreino.dias[MT_DIA_ATUAL]) u.meuTreino.dias[MT_DIA_ATUAL]=[];
  u.meuTreino.dias[MT_DIA_ATUAL].push({id:null, nome, sets:3, reps:'12', rest:60, custom:true});
  saveU(u);
  closeModal('modal-add-ex');
  renderGym(u);
  fqToast('✅ '+nome+' adicionado','ok');
}

function concluirTreinoProprio(){
  const u=getU(); if(!u) return;
  const exs=(u.meuTreino?.dias?.[MT_DIA_ATUAL])||[];
  if(!exs.length){ fqToast('Adicione exercícios antes de concluir.','warn'); return; }

  u.coins=(u.coins||0)+8;
  u.stats=u.stats||{}; u.stats.treinos=(u.stats.treinos||0)+1;
  fqAdicionarXP(u,40);
  u.workoutHistory=u.workoutHistory||[];
  u.workoutHistory.push({date:new Date().toISOString(), day:MT_DIA_ATUAL+' (meu treino)', exercises:exs.map(e=>e.nome)});
  atualizarStreak(u);
  saveU(u);
  fqToast('🎉 Treino concluído! +40 XP','ok');
  if(typeof dispararConfete==='function') dispararConfete();
  renderGym(u);
}

function renderGym(u){
  atualizarBarraModo(u);
  if(getModoTreino(u)==='meu'){
    document.getElementById('gym-hero-tag').textContent='MEU TREINO';
    document.getElementById('gym-hero-title').textContent='Treino Personalizado';
    document.getElementById('gym-hero-sub').textContent='Montado por você';
    document.getElementById('gym-prog-bar').style.width='100%';
    renderMeuTreino(u);
    return;
  }
  const P=getGP(u);const wks=Object.keys(P);curGymWeek=`Semana ${u.gymWeek||1}`;const prog=P[curGymWeek]||P[wks[0]]||{fase:'',days:{}};if(!P[curGymWeek]&&wks[0])curGymWeek=wks[0];
  if(!u.trainApproved){
    document.getElementById('gym-hero-tag').textContent='EM BREVE';
    document.getElementById('gym-hero-title').textContent='Treino Personalizado';
    document.getElementById('gym-hero-sub').textContent='Aguardando liberação do seu treino...';
    document.getElementById('gym-prog-bar').style.width='0%';
    document.getElementById('gym-wtabs').innerHTML='';
    document.getElementById('gym-day-btns').innerHTML='';
    document.getElementById('gym-exercises').innerHTML=`<div style="text-align:center;padding:40px 20px"><div style="font-size:52px;margin-bottom:16px">⏳</div><div style="font-size:16px;font-weight:800;margin-bottom:8px">Treino em preparação</div><div style="font-size:13px;color:var(--t2);line-height:1.6">Rennan está montando seu plano personalizado.<br>Fique de olho — em breve estará disponível!</div></div>`;
    document.getElementById('gym-complete-btn').innerHTML='';
    return;
  }
  document.getElementById('gym-hero-tag').textContent=prog.fase||'PROGRAMA RENNAN DIAS';
  document.getElementById('gym-hero-title').textContent=curGymWeek;
  document.getElementById('gym-hero-sub').textContent=`${u.gymWeek||1} de ${wks.length} semanas completas`;
  document.getElementById('gym-prog-bar').style.width=Math.round(((u.gymWeek||1)/wks.length)*100)+'%';
  // Week tabs
  document.getElementById('gym-wtabs').innerHTML=wks.map(w=>{const wn=parseInt(w.split(' ')[1]);const lk=wn>(u.gymWeek||1);const dn=wn<(u.gymWeek||1);return `<div class="wk-week-btn ${w===curGymWeek?'active':''}" onclick="${lk?'':'selGW(\''+w+'\')' }" style="${lk?'opacity:.3;cursor:not-allowed':''}">${dn?'✅ ':lk?'🔒 ':''}${w}</div>`;}).join('');
  renderGymWeek(curGymWeek,u);
}
function selGW(w){const u=getU();if(!u)return;curGymWeek=w;document.querySelectorAll('#gym-wtabs .wk-week-btn').forEach(t=>t.classList.toggle('active',t.textContent.includes(w.replace('Semana ',''))));renderGymWeek(w,u);}
function renderGymWeek(w,u){
  const P=getGP(u);const days=Object.keys(P[w].days);curGymDay=days[0];
  document.getElementById('gym-day-btns').innerHTML=days.map((d,i)=>{const dk=`${w}_${d}`;const dn=u.gymDone&&u.gymDone[dk];return `<div class="wk-day-btn ${i===0?'active':''} ${dn?'done':''}" onclick="selGD('${w}','${d}',this)">${dn?'✅ ':'▶ '}${d}</div>`;}).join('');
  renderGymDay(w,days[0],u);
}
function selGD(w,d,el){const u=getU();if(!u)return;curGymDay=d;document.querySelectorAll('#gym-day-btns .wk-day-btn').forEach(t=>t.classList.remove('active'));el.classList.add('active');renderGymDay(w,d,u);}
function renderGymDay(w,d,u){
  const P=getGP(u);const exs=P[w].days[d];const dk=`${w}_${d}`;const dayDone=u.gymDone&&u.gymDone[dk];
  document.getElementById('gym-exercises').innerHTML=exs.map((ed,i)=>{
    const ex=getExById(ed.id);if(!ex)return '';
    const lk=`${w}_${d}_${ex.id}`;const sl=(u.loadHistory&&u.loadHistory[lk])||ed.load||'';
    return `<div class="ep-card" id="ep-${i}">
      <div class="ep-header" onclick="togEp(${i})">
        <div class="ep-num ${dayDone?'done':''}">${i+1}</div>
        <div class="ep-info"><div class="ep-title">${exNome(ex)}</div><div class="ep-sub">${ex.muscle} · ${ex.equipment}</div></div>
        <div class="ep-chips"><span class="ep-chip">${ed.sets}×${ed.reps}</span><span class="ep-chip">⏱${ed.rest||60}s</span>${ed.tecnica?`<span class="ep-chip" style="background:rgba(229,9,20,.18);color:#ff5a63;border:1px solid rgba(229,9,20,.35)">🔥 ${ed.tecnica}</span>`:''}</div>
        <span class="ep-chv">▾</span>
      </div>
      <div class="ep-body">
        <div class="ep-thumb" style="position:relative;overflow:hidden">
          ${renderExThumb(ex)}
        </div>
        <div class="ep-obs">${ed.tecnica?`<div style="background:rgba(229,9,20,.1);border:1px solid rgba(229,9,20,.3);border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:12px;color:#ff8a90;font-weight:600">🔥 ${ed.tecnicaObs}</div>`:''}💡 ${ex.obs}</div>
        <table class="sets-tbl">
          <tr><th>Série</th><th>Reps</th><th>Carga</th><th>✓</th></tr>
          ${Array.from({length:ed.sets},(_,si)=>{const sk=`${w}_${d}_${i}_s${si}`;const sd=u.gymDone&&u.gymDone[sk];return `<tr class="set-row ${sd?'done':''}" id="sr-${i}-${si}"><td>Série ${si+1}</td><td>${ed.reps}</td><td><input class="carga-inp" id="ci-${i}-${si}" value="${sl}" placeholder="kg" onchange="saveCarga('${lk}',${i},${si})"/></td><td><div class="set-chk ${sd?'ck':''}" id="sc-${i}-${si}" onclick="chkSet('${w}','${d}',${i},${si},${ed.sets},${ed.rest||60},'${lk}')">${sd?'✓':''}</div></td></tr>`;}).join('')}
        </table>
      </div>
    </div>`;
  }).join('');
  document.getElementById('gym-complete-btn').innerHTML=`<button class="btn-ep-done" onclick="completeWk('${w}','${d}')" ${dayDone?'disabled':''} style="${dayDone?'opacity:.5':''}">${dayDone?'✅ Treino concluído!':'▶ Concluir treino do dia'}</button>`;
}
function togEp(i){document.getElementById(`ep-${i}`).classList.toggle('open');}
function saveCarga(lk,ei,si){const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;const v=document.getElementById(`ci-${ei}-${si}`)?.value||'';if(!u.loadHistory)u.loadHistory={};u.loadHistory[lk]=v;DB.set('fq_users',users);}
function chkSet(w,d,ei,si,total,rest,lk){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;
  const sk=`${w}_${d}_${ei}_s${si}`;if(!u.gymDone)u.gymDone={};if(u.gymDone[sk])return;
  u.gymDone[sk]=true;const v=document.getElementById(`ci-${ei}-${si}`)?.value||'';
  if(!u.loadHistory)u.loadHistory={};if(v)u.loadHistory[lk]=v;DB.set('fq_users',users);
  const chk=document.getElementById(`sc-${ei}-${si}`);if(chk){chk.classList.add('ck');chk.textContent='✓';}
  const row=document.getElementById(`sr-${ei}-${si}`);if(row)row.classList.add('done');
  if(si<total-1)startTimer(rest);
}

// ── Chama de streak escalonada (feedback visual crescente) ──
function streakFlame(dias){
  if(dias>=100)return ' 🔥🔥🔥';
  if(dias>=30)return ' 🔥🔥';
  if(dias>=7)return ' 🔥';
  if(dias>=3)return ' ✨';
  return '';
}

function atualizarStreak(u){
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const hojeStr=hoje.toDateString();
  if(u.ultimoTreinoStreak===hojeStr)return; // já treinou hoje, não duplica
  if(u.ultimoTreinoStreak){
    const ultimo=new Date(u.ultimoTreinoStreak);ultimo.setHours(0,0,0,0);
    const diffDias=Math.round((hoje-ultimo)/(1000*60*60*24));
    if(diffDias===1){
      u.streak=(u.streak||1)+1; // treinou ontem → continua a sequência
    }else if(diffDias>1){
      u.streak=1; // pulou dia(s) → reseta
    }
    // diffDias===0 não deveria acontecer (já tratado acima), diffDias<0 ignora
  }else{
    u.streak=1; // primeiro treino registrado
  }
  u.ultimoTreinoStreak=hojeStr;
  if(!u.melhorStreak||u.streak>u.melhorStreak)u.melhorStreak=u.streak;
  // Marco redondo → aparece no mural (evita spam: só em números "cheios")
  if([7,14,21,30,50,60,100,150,200,365].includes(u.streak)){
    try{registrarEventoComunidade('streak',{nome:u.name,dias:u.streak,titulo:tituloAtual(u)?.emoji});}catch(e){}
    try{dispararConfete(24);}catch(e){}
    try{fqCelebrarStreak(u.streak);}catch(e){}
    fqVibrar([50,80,50,80,100]);
  }
}

function completeWk(w,d){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;
  const dk=`${w}_${d}`;if(u.gymDone&&u.gymDone[dk])return;
  if(!u.gymDone)u.gymDone={};u.gymDone[dk]=true;
  u.stats.treinos=(u.stats.treinos||0)+1;u.coins=(u.coins||0)+15;fqAdicionarXP(u,80);
  atualizarStreak(u);
  try{registrarEventoComunidade('treino',{nome:u.name,nome_treino:d,titulo:tituloAtual(u)?.emoji});}catch(e){}
  const P=getGP(u);const exs=P[w].days[d];
  if(!u.workoutHistory)u.workoutHistory=[];
  u.workoutHistory.push({week:w,day:d,date:new Date().toLocaleDateString('pt-BR'),exercises:exs.map(e=>{const ex=getExById(e.id);return{name:ex?.name||e.id,load:u.loadHistory?.[`${w}_${d}_${e.id}`]||''};})});
  const allDays=Object.keys(P[w].days);const tw=Object.keys(P).length;
  if(allDays.every(dd=>u.gymDone[`${w}_${dd}`])){const wn=parseInt(w.split(' ')[1]);if(wn===(u.gymWeek||1)&&(u.gymWeek||1)<tw){u.gymWeek=(u.gymWeek||1)+1;u.coins+=50;fqAdicionarXP(u,200);u.stats.semanas++;}}
  DB.set('fq_users',users);loadApp(email);switchTab('gym',document.querySelectorAll('.nbtn')[1]);
}

// ══ PRs ══
function renderPRs(prs){
  document.getElementById('pr-count').textContent=prs.length;
  document.getElementById('prs-list').innerHTML=!prs.length?'<div style="color:var(--mu);font-size:12px;padding:8px 0">Nenhum PR ainda. Quebre o primeiro recorde! 🎬</div>':prs.map(pr=>`<div class="prc"><div class="prw">⭐</div><div style="flex:1"><div style="font-size:13px;font-weight:700">${pr.exercise}</div><div style="font-size:10px;color:var(--mu);margin-top:2px">${pr.date}</div></div><div style="background:rgba(243,156,18,.08);border:1px solid rgba(243,156,18,.15);border-radius:6px;padding:5px 10px;font-size:15px;font-weight:900;color:#f39c12">${pr.value}</div></div>`).join('');
}
function logPR(){
  const email=DB.get('fq_cur');const users=DB.get('fq_users')||{};const u=users[email];if(!u)return;
  const ex=prompt('Exercício (ex: Supino, Corrida 5km):');if(!ex)return;
  const val=prompt('Resultado (ex: 90kg, 24:30):');if(!val)return;
  if(!u.prs)u.prs=[];u.prs.push({exercise:ex,value:val,date:new Date().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}),icon:'⭐'});
  u.coins=(u.coins||0)+20;fqAdicionarXP(u,100);DB.set('fq_users',users);
  try{registrarEventoComunidade('pr',{nome:u.name,ex:ex,titulo:tituloAtual(u)?.emoji});}catch(e){}
  try{dispararConfete(36);}catch(e){}
  loadApp(email);
}

// ══ NOTIFICAÇÕES DE TREINO ══
async function pedirPermissaoNotif(){
  if(!('Notification' in window)) return false;
  if(Notification.permission==='granted') return true;
  if(Notification.permission==='denied') return false;
  const perm = await Notification.requestPermission();
  return perm==='granted';
}

async function agendarNotifTreino(){
  const u=getU();if(!u)return;
  const ok=await pedirPermissaoNotif();
  if(!ok)return;
  // Salvar preferência
  const users=DB.get('fq_users')||{};
  if(users[u.email]){users[u.email].notifAtivas=true;DB.set('fq_users',users);}
  // Notificação de teste imediata
  try{
    new Notification('🔥 FitQuest',{
      body:'Notificações ativadas! Vamos te lembrar dos treinos.',
      icon:'icon-192.png',badge:'icon-192.png'
    });
  }catch(e){
    // Alguns browsers exigem service worker para notificar
    if(navigator.serviceWorker?.ready){
      const reg=await navigator.serviceWorker.ready;
      reg.showNotification('🔥 FitQuest',{
        body:'Notificações ativadas! Vamos te lembrar dos treinos.',
        icon:'icon-192.png',badge:'icon-192.png'
      });
    }
  }
}

// Verificar diariamente se tem treino pendente (roda quando o app abre)
function checarTreinoPendente(){
  const u=getU();if(!u||!u.notifAtivas)return;
  if(Notification.permission!=='granted')return;
  const hoje=new Date().toDateString();
  const ultimaNotif=DB.get('fq_ultima_notif');
  if(ultimaNotif===hoje)return; // já notificou hoje
  // Checar se treinou hoje
  const treinouHoje=(u.workoutHistory||[]).some(w=>new Date(w.date).toDateString()===hoje);
  if(!treinouHoje){
    const hora=new Date().getHours();
    if(hora>=17){ // só lembra a partir das 17h
      DB.set('fq_ultima_notif',hoje);
      const msgs=[
        '💪 Ainda dá tempo de treinar hoje! Seu streak agradece.',
        '🔥 O treino de hoje está te esperando. Bora?',
        '🏋️ 40 minutos hoje = resultado amanhã. Vamos!',
        `⚡ ${u.name?.split(' ')[0]||'Atleta'}, seu treino de hoje ainda não foi feito!`
      ];
      const msg=msgs[Math.floor(Math.random()*msgs.length)];
      try{
        new Notification('FitQuest — Lembrete',{body:msg,icon:'icon-192.png'});
      }catch(e){
        navigator.serviceWorker?.ready?.then(reg=>reg.showNotification('FitQuest — Lembrete',{body:msg,icon:'icon-192.png'}));
      }
    }
  }
}
// Rodar checagem ao carregar o app
setTimeout(checarTreinoPendente, 5000);




// Parceira que acompanha a protagonista: anda junto, entra no mesmo veículo
// e desce do outro lado. Sem dependência de DOM (testável em node).

const FOLLOW_GAP = 40;        // distância confortável atrás da protagonista
const WALK_MAX = 205;         // um pouco mais rápida que a protagonista (175) para alcançar
const BOARD_RADIUS = 170;     // perto assim, ela anda até o carro; mais longe, "pula" para dentro
const TELEPORT_DIST = 460;    // se ficar muito para trás, reaparece perto
const STUCK_SECONDS = 1.6;

export function createPartner(charDef) {
  return {
    id: charDef.id,
    name: charDef.name,
    sprites: {
      ...(charDef.sprites || {}),
      skinColor: charDef.skinColor || '#f1c27d',
      sleeveColor: charDef.sleeveColor || '',
      pantsColor: charDef.pantsColor || '',
      shoeColor: charDef.shoeColor || '',
    },
    x: 0,
    y: 0,
    angle: 0,
    speed: 0,
    walkPhase: 0,
    radius: 10,
    state: 'unplaced', // unplaced | following | boarding | riding
    vehicleId: null,
    stuckTimer: 0,
    visible: false,
  };
}

/** Ponto atrás e um pouco ao lado da protagonista, conforme para onde ela olha. */
export function followTarget(player, gap = FOLLOW_GAP) {
  const a = player.angle || 0;
  return {
    x: player.x - Math.cos(a) * gap - Math.sin(a) * gap * 0.55,
    y: player.y - Math.sin(a) * gap + Math.cos(a) * gap * 0.55,
  };
}

/**
 * Atualiza a parceira.
 * ctx = { player, playerVehicle, dt, resolve(x, y, r) → {x, y} }
 * Retorna um evento opcional: 'boarded' | 'exited' | 'teleported' | null.
 */
export function updatePartner(partner, ctx) {
  const { player, playerVehicle, dt } = ctx;
  const resolve = ctx.resolve || ((x, y) => ({ x, y }));
  let event = null;

  if (partner.state === 'unplaced') {
    const t = followTarget(player);
    const r = resolve(t.x, t.y, partner.radius);
    partner.x = r.x;
    partner.y = r.y;
    partner.angle = player.angle || 0;
    partner.state = playerVehicle ? 'riding' : 'following';
    partner.vehicleId = playerVehicle?.id ?? null;
  }

  // Protagonista dirigindo: parceira embarca
  if (playerVehicle) {
    if (partner.state === 'riding' && partner.vehicleId === playerVehicle.id) {
      partner.x = playerVehicle.x;
      partner.y = playerVehicle.y;
      partner.angle = playerVehicle.angle;
      partner.speed = 0;
      partner.visible = playerVehicle.kind === 'moto';
      return null;
    }
    const d = Math.hypot(playerVehicle.x - partner.x, playerVehicle.y - partner.y);
    if (partner.state !== 'boarding') {
      partner.state = d <= BOARD_RADIUS ? 'boarding' : 'riding';
      if (partner.state === 'riding') {
        partner.vehicleId = playerVehicle.id;
        return 'boarded';
      }
    }
    // Andando até a porta do carona
    if (d < 16 || d > BOARD_RADIUS * 1.6) {
      partner.state = 'riding';
      partner.vehicleId = playerVehicle.id;
      partner.visible = playerVehicle.kind === 'moto';
      return 'boarded';
    }
    const step = Math.min(d, 290 * dt);
    partner.angle = Math.atan2(playerVehicle.y - partner.y, playerVehicle.x - partner.x);
    partner.x += Math.cos(partner.angle) * step;
    partner.y += Math.sin(partner.angle) * step;
    partner.speed = 290;
    partner.walkPhase += dt * 20;
    partner.visible = true;
    return null;
  }

  // Protagonista desceu: parceira sai pelo outro lado do veículo
  if (partner.state === 'riding' || partner.state === 'boarding') {
    const v = ctx.lastVehicle;
    if (v) {
      const side = Math.sign((player.x - v.x) * -Math.sin(v.angle) + (player.y - v.y) * Math.cos(v.angle)) || 1;
      const off = (v.width || 24) * 0.5 + 14;
      const px = v.x - Math.sin(v.angle) * off * -side;
      const py = v.y + Math.cos(v.angle) * off * -side;
      const r = resolve(px, py, partner.radius);
      partner.x = r.x;
      partner.y = r.y;
    } else {
      const t = followTarget(player);
      const r = resolve(t.x, t.y, partner.radius);
      partner.x = r.x;
      partner.y = r.y;
    }
    partner.state = 'following';
    partner.vehicleId = null;
    partner.stuckTimer = 0;
    event = 'exited';
  }

  partner.visible = true;
  const target = followTarget(player);
  const toTarget = Math.hypot(target.x - partner.x, target.y - partner.y);
  const toPlayer = Math.hypot(player.x - partner.x, player.y - partner.y);

  if (toPlayer > TELEPORT_DIST || partner.stuckTimer > STUCK_SECONDS) {
    const r = resolve(target.x, target.y, partner.radius);
    partner.x = r.x;
    partner.y = r.y;
    partner.stuckTimer = 0;
    partner.speed = 0;
    return 'teleported';
  }

  if (toTarget > 10 && toPlayer > FOLLOW_GAP * 0.75) {
    const speed = Math.min(WALK_MAX, Math.max(70, toTarget * 3.2));
    const ang = Math.atan2(target.y - partner.y, target.x - partner.x);
    const nx = partner.x + Math.cos(ang) * speed * dt;
    const ny = partner.y + Math.sin(ang) * speed * dt;
    const r = resolve(nx, ny, partner.radius);
    const moved = Math.hypot(r.x - partner.x, r.y - partner.y);
    partner.stuckTimer = moved < speed * dt * 0.25 && toPlayer > 90 ? partner.stuckTimer + dt : 0;
    partner.x = r.x;
    partner.y = r.y;
    partner.angle = ang;
    partner.speed = speed;
    partner.walkPhase += dt * 14;
  } else {
    partner.speed = 0;
    partner.walkPhase = 0;
    partner.stuckTimer = 0;
    // olha para onde a protagonista olha
    partner.angle = player.angle || partner.angle;
  }

  // não sobrepor a protagonista
  const dx = partner.x - player.x;
  const dy = partner.y - player.y;
  const dist = Math.hypot(dx, dy);
  const minDist = partner.radius + (player.radius || 10) + 2;
  if (dist > 0.01 && dist < minDist) {
    partner.x = player.x + (dx / dist) * minDist;
    partner.y = player.y + (dy / dist) * minDist;
  }
  return event;
}

export const PARTNER_LINES = {
  boarded: [
    'Bora! Eu vou de carona.',
    'Cinto de segurança, hein!',
    'Dirige direito, eu tô vendo!',
    'Pode acelerar, mas sem poste!',
  ],
  exited: [
    'Ufa, chegamos inteiras!',
    'Bela baliza, Ana!',
    'Tô logo atrás de você.',
  ],
  drift: [
    'Que drift! 🔥',
    'Uhuuul! De novo!',
    'Isso foi lindo!',
  ],
  crash: [
    'Ai! Olha o poste!',
    'Ana, a lataria!!',
    'Quem te deu carteira?!',
  ],
  idle: [
    'E aí, pra onde agora?',
    'Olha o mapa, Ana!',
    'Essa cidade é enorme.',
    'Tô com fome... depois da missão, pizza?',
  ],
  mission: [
    'Nova missão! Vamos nessa.',
    'Confia, a gente consegue.',
  ],
  shoot: [
    'Calma, Ana!!',
    'Abaixa! Abaixa!',
    'Isso vai dar polícia...',
  ],
  police: [
    'Sujou! A polícia!',
    'Acelera, Ana!!',
    'Despista eles!',
    'Sirene! Sirene!',
  ],
  escaped: [
    'Ufa! Despistamos!',
    'Ninguém pega a gente!',
  ],
  busted: [
    'Ai, não... fomos pegas.',
    'Lá se vai o nosso dinheiro...',
  ],
  shop: [
    'Boa compra!',
    'Gastou, hein? Valeu a pena.',
    'Agora sim, equipadas!',
  ],
  cheat: [
    'Como você sabia desse código?!',
    'Trapaceira! Adorei.',
  ],
};

export function pickLine(kind, rnd = Math.random) {
  const pool = PARTNER_LINES[kind] || PARTNER_LINES.idle;
  return pool[Math.floor(rnd() * pool.length)];
}

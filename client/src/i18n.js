// English / Spanish. The language is picked with the two buttons at the top of the start
// screen and remembered; changing it reloads the page, so everything (including signs
// painted into the world) is built in the chosen language.
//
// English text is written inline as tr('Text with {0}', value); ES maps that same English
// text to Spanish. Anything missing from ES simply shows in English.
const ES = {
  // ---- start screen
  'The cows came back wrong. Hold Rancho La Esmeralda.': 'Las vacas regresaron mal. Defiende el Rancho La Esmeralda.',
  'Your name': 'Tu nombre',
  'Rancher': 'Ranchero',
  'Room code': 'Código de sala',
  '(friends type the same code to play together)': '(tus amigos escriben el mismo código para jugar juntos)',
  'Graphics': 'Gráficos',
  'Ultra (strong gaming PC)': 'Ultra (PC gamer potente)',
  'High (gaming PC / recent Mac)': 'Alto (PC gamer / Mac reciente)',
  'Medium (most laptops, tablets)': 'Medio (la mayoría de laptops y tabletas)',
  'Low (phones, older computers)': 'Bajo (celulares, computadoras viejas)',
  'Look sensitivity': 'Sensibilidad de la vista',
  'PLAY': 'JUGAR',
  'Choose your character': 'Elige tu personaje',
  'Click to play': 'Haz clic para jugar',
  'Full screen on iPhone: tap <b>Share</b> → <b>Add to Home Screen</b>, then play from the new icon.': 'Pantalla completa en iPhone: toca <b>Compartir</b> → <b>Agregar a inicio</b> y juega desde el ícono nuevo.',
  'Hold your phone sideways. Left thumb: drag to move (push all the way up to sprint). Right thumb: drag to look, hold FIRE to shoot (drag on it to track). Tap AIM to aim down sights. Hold USE to buy guns, revive and rebuild barricades, and to get in a truck.':
    'Pon el celular de lado. Pulgar izquierdo: arrastra para moverte (hasta arriba para correr). Pulgar derecho: arrastra para mirar, mantén FUEGO para disparar (arrastra sobre él para seguir al blanco). Toca MIRA para apuntar. Mantén USAR para comprar armas, revivir, reparar barricadas y subirte a una camioneta.',
  'move': 'moverse', 'sprint': 'correr', 'jump': 'saltar', 'aim / shoot': 'apuntar / disparar', 'reload': 'recargar',
  '(hold) revive': '(mantener) revivir', 'flashlight': 'linterna', 'scores': 'puntajes', 'switch gun': 'cambiar arma',
  'machete': 'machete', 'grenade': 'granada', 'crouch / slide': 'agacharse / deslizarse', 'buy guns, drive trucks': 'comprar armas, manejar camionetas', 'aim': 'apuntar',
  'Mouse': 'Ratón', 'RMB': 'Clic der.', 'Space': 'Espacio',
  'Waking the herd...': 'Despertando al ganado...', 'Loading the sky...': 'Cargando el cielo...', 'Shaping the land...': 'Formando el terreno...',
  'Building the hacienda...': 'Construyendo la hacienda...', 'Growing the jungle...': 'Sembrando la selva...',
  'Connecting...': 'Conectando...',
  'Could not reach the game server.': 'No se pudo conectar con el servidor.',
  'That room is full (8 players max). Try another room code.': 'Esa sala está llena (máximo 8 jugadores). Prueba otro código.',
  'Turn your phone sideways to play': 'Pon el celular de lado para jugar',
  // ---- HUD
  'WAVE': 'OLEADA',
  'Next wave in {0}s': 'Siguiente oleada en {0}s',
  '{0} left': 'Quedan {0}',
  'cow': 'vaca', 'cows': 'vacas', 'local': 'lugareño', 'locals': 'lugareños', 'enemy': 'enemigo', 'enemies': 'enemigos',
  'Game over': 'Fin del juego',
  'RELOADING': 'RECARGANDO', 'NO AMMO': 'SIN BALAS', 'RELOAD': 'RECARGA', 'R  RELOAD': 'R  RECARGAR',
  'INSTA-KILL': 'MUERTE INSTANTÁNEA', 'DOUBLE POINTS': 'PUNTOS DOBLES', 'MAX AMMO': 'BALAS AL MÁXIMO', 'KABOOM': 'KABÚM',
  "YOU'RE DOWN": 'ESTÁS HERIDO', 'SPECTATING': 'OBSERVANDO',
  'Being revived... {0}%': 'Te están reviviendo... {0}%',
  'Bleeding out in {0}s. A teammate can hold {1} next to you to revive.': 'Te desangras en {0}s. Un compañero puede mantener {1} a tu lado para revivirte.',
  'You come back when this wave is cleared.': 'Regresas cuando termine esta oleada.',
  'Reviving {0}... {1}%': 'Reviviendo a {0}... {1}%',
  'Hold {0} to revive {1}': 'Mantén {0} para revivir a {1}',
  'Press': 'Presiona', 'Tap': 'Toca',
  '{0} {1} to buy {2}': '{0} {1} para comprar {2}',
  '{0} {1} to buy ammo for {2}': '{0} {1} para comprar balas de {2}',
  '{0} {1} to drive the {2}': '{0} {1} para manejar la {2}',
  '{0} {1} to ride in the {2}': '{0} {1} para subirte a la {2}',
  '{0} {1} to ride in the back of the {2}': '{0} {1} para subirte a la caja de la {2}',
  'WASD drive, Space handbrake,': 'WASD manejar, Espacio freno de mano,',
  'stick to drive, JUMP handbrake,': 'palanca para manejar, SALTO freno de mano,',
  '{0} get out': '{0} bajarse', '{0} to get out': '{0} para bajarte',
  'Rebuilding...': 'Reparando...',
  'Hold {0} to rebuild barricade': 'Mantén {0} para reparar la barricada',
  'Room': 'Sala', 'invite link:': 'enlace para invitar:', 'Player': 'Jugador', 'Kills': 'Bajas', 'Score': 'Puntos', '(down)': '(herido)', '(out)': '(fuera)',
  // ---- banners and the message feed
  'WAVE {0}': 'OLEADA {0}',
  '{0} zombie cows are coming for the house': '{0} vacas zombi vienen por la casa',
  'WAVE {0}: THE LOCALS': 'OLEADA {0}: LOS LUGAREÑOS',
  'WAVE {0}: THE GOLDEN COW': 'OLEADA {0}: LA VACA DE ORO',
  "Rafael's prize cow is loose in the herd. Catch her before she gets away: points for everyone.": 'La vaca premiada de Rafael anda suelta en la manada. Agárrenla antes de que se escape: puntos para todos.',
  'WAVE {0}: STAMPEDE!': 'OLEADA {0}: ¡ESTAMPIDA!',
  '{0} cows charging at once, all from one side. Get behind something.': '{0} vacas en estampida, todas del mismo lado. Cúbranse.',
  'WAVE {0}: BLOATED COWS': 'OLEADA {0}: VACAS HINCHADAS',
  'They burst a moment after they die. Kill them away from you, and from each other... or not.': 'Revientan un momento después de morir. Mátenlas lejos de ustedes y lejos unas de otras... o no.',
  'WAVE {0}: MARSH FOG': 'OLEADA {0}: NEBLINA DEL PANTANO',
  'Fog is rolling in off the pond. Listen for them.': 'Sube la neblina del estanque. Escúchenlas.',
  'THE GOLDEN COW IS DOWN': '¡CAYÓ LA VACA DE ORO!',
  '{0} got her. {1} points each, and a prize.': '{0} la agarró. {1} puntos para cada quien, y un premio.',
  '{0} points each, and a prize.': '{0} puntos para cada quien, y un premio.',
  'THE GOLDEN COW GOT AWAY': 'SE ESCAPÓ LA VACA DE ORO',
  'Rafael will never forgive you.': 'Rafael nunca se los va a perdonar.',
  '{0} locals with machetes are coming instead of the herd': 'En vez del ganado vienen {0} lugareños con machetes',
  'WAVE {0}: RAFAEL': 'OLEADA {0}: RAFAEL',
  "He's huge, he's drunk, and he's throwing bottles. Keep moving.": 'Es enorme, está borracho y avienta botellas. No dejes de moverte.',
  'WAVE {0} SURVIVED': 'OLEADA {0} SUPERADA',
  'Fix the barricades. Hold {0} at a window.': 'Repara las barricadas. Mantén {0} en una ventana.',
  'THE HERD GOT IN': 'EL GANADO ENTRÓ',
  'You held the ranch for {0} waves. Restarting...': 'Defendiste el rancho {0} oleadas. Reiniciando...',
  'You held the ranch for 1 wave. Restarting...': 'Defendiste el rancho 1 oleada. Reiniciando...',
  'picked up by {0}': 'lo agarró {0}',
  'Ammo refilled: {0}': 'Balas recargadas: {0}',
  'Bought {0}': 'Compraste {0}',
  'Not enough points (${0} needed)': 'No te alcanzan los puntos (necesitas ${0})',
  'Lost connection to the server. Refresh to rejoin.': 'Se perdió la conexión con el servidor. Recarga la página para volver.',
  '{0} joined the ranch': '{0} llegó al rancho',
  '{0} revived {1}': '{0} revivió a {1}',
  '{0} bled out': '{0} se desangró',
  '{0} got knocked down by a cow! Back up in 20 seconds': '¡Una vaca tumbó a {0}! Se levanta en 20 segundos',
  '{0} is down! Hold E next to them to revive': '¡{0} está herido! Mantén E a su lado para revivirlo',
  // ---- Zombies machinery
  'BULL HIDE': 'PIEL DE TORO', 'SECOND WIND': 'SEGUNDO AIRE', 'QUICK HANDS': 'MANO RÁPIDA', 'DOUBLE TEQUILA': 'DOBLE TEQUILA', 'MUSTANG': 'MUSTANG',
  'Two and a half times the health': 'Dos veces y media más vida',
  'Revive twice as fast. Alone, it gets you back up once': 'Revives el doble de rápido. Si juegas solo, te levanta una vez',
  'Reload twice as fast': 'Recargas el doble de rápido',
  'Shoot a third faster and hit a quarter harder': 'Disparas un tercio más rápido y pegas un cuarto más fuerte',
  'Run faster and sprint longer': 'Corres más rápido',
  'THE POWER IS ON': 'HAY LUZ',
  '{0} started the generator. Perks and El Taller are working.': '{0} prendió el generador. Ya funcionan las bebidas y El Taller.',
  'You lost your perks': 'Perdiste tus bebidas',
  'Turn the power on first: the generator behind the house': 'Primero prende la luz: el generador detrás de la casa',
  'You already have that perk': 'Ya tienes esa bebida',
  'You can only hold four perks': 'Solo puedes tener cuatro bebidas',
  "It's busy": 'Está ocupado',
  'That gun is already upgraded': 'Esa arma ya está mejorada',
  'The box is moving!': '¡La caja se va!',
  'The mystery box has moved. Look for the light.': 'La caja misteriosa se movió. Busca la luz.',
  'Upgraded at El Taller': 'Mejorada en El Taller',
  '{0} electrified the south gate': '{0} electrificó la puerta sur',
  '{0} {1} to turn on the power': '{0} {1} para prender la luz',
  'You have {0}': 'Ya tienes {0}',
  '{0}: needs power': '{0}: necesita luz',
  '{0} {1} to drink {2}': '{0} {1} para tomar {2}',
  '{0} {1} to take {2}': '{0} {1} para agarrar {2}',
  '{0} {1} for a random gun': '{0} {1} para un arma al azar',
  'El Taller: needs power': 'El Taller: necesita luz',
  'Upgrading...': 'Mejorando...',
  '{0} {1} to upgrade {2}': '{0} {1} para mejorar {2}',
  'The fence is live': 'La cerca está electrificada',
  'The fence is recharging: {0}s': 'La cerca se está recargando: {0}s',
  '{0} {1} to electrify the gate': '{0} {1} para electrificar la puerta',
  'CARPENTER': 'CARPINTERO', 'FIRE SALE': 'REMATE',
  'Getting back up... {0}%': 'Levantándote... {0}%',
  '{0} got back up': '{0} se levantó',
  'COCONUT CANNON': 'CAÑÓN DE COCOS',
  // ---- weapons
  'RANCH RIFLE': 'RIFLE DEL RANCHO', 'REVOLVER': 'REVÓLVER', 'PUMP SHOTGUN': 'ESCOPETA', 'HUNTING RIFLE': 'RIFLE DE CAZA', 'LA BESTIA LMG': 'LA BESTIA',
  // ---- touch buttons
  'FIRE': 'FUEGO', 'AIM': 'MIRA', 'JUMP': 'SALTO', 'CROUCH': 'AGACHAR', 'NADE': 'GRANADA', 'MELEE': 'MACHETE', 'SWAP': 'CAMBIO', 'USE': 'USAR', 'LIGHT': 'LUZ', 'SCORES': 'PUNTOS',
};
// ("3 cows left" and "Ana left" need different Spanish, so the second has its own key)
ES['{0} left the ranch'] = '{0} se fue';

function pick() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q === 'es' || q === 'en') return q;
    const saved = localStorage.getItem('rd-lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch {}
  return typeof navigator !== 'undefined' && /^es\b/i.test(navigator.language || '') ? 'es' : 'en';
}
export const lang = typeof location === 'undefined' ? 'en' : pick();

export function tr(text, ...args) {
  const s = lang === 'es' && ES[text] != null ? ES[text] : text;
  return args.length ? s.replace(/\{(\d)\}/g, (m, i) => args[i]) : s;
}

export function setLang(l) {
  if (l === lang) return;
  try { localStorage.setItem('rd-lang', l); } catch {}
  const u = new URL(location.href); u.searchParams.delete('lang'); location.href = u.toString();
}

// Translate the page's own markup: elements marked data-tr (their text), data-tr-ph (placeholder).
export function translateDom(root = document) {
  document.documentElement.lang = lang;
  for (const el of root.querySelectorAll('[data-tr]')) el.innerHTML = tr(el.innerHTML.trim());
  for (const el of root.querySelectorAll('[data-tr-ph]')) el.placeholder = tr(el.placeholder);
  for (const b of root.querySelectorAll('#lang button')) { b.classList.toggle('sel', b.dataset.lang === lang); b.onclick = () => setLang(b.dataset.lang); }
}

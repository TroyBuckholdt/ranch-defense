// The jokes: kill-feed quips, what the family says out loud, and the end-of-game awards.
// Every entry is [English, Spanish]; the server sends the English as the key and the client
// translates it (client/src/i18n.js merges BANTER_ES into its dictionary).

// {0} is the player's name ({1} a second player).
const QUIPS = {
  join: [
    ['{0} joined the ranch', '{0} llegó al rancho'],
    ['{0} showed up. The cows are not impressed.', 'Llegó {0}. Las vacas no se impresionan.'],
    ['{0} is here to help. Allegedly.', '{0} vino a ayudar. Según.'],
  ],
  downCow: [
    ['{0} was trampled by a cow they definitely saw coming', 'A {0} le pasó por encima una vaca que claramente vio venir'],
    ['{0} tried to pet it', '{0} quiso acariciarla'],
    ['{0} lost an argument with a cow', '{0} perdió una discusión con una vaca'],
    ['{0} is lying down on the job', '{0} se echó a descansar en horas de trabajo'],
    ['{0} got milked', 'A {0} le tocó la ordeña'],
  ],
  downBull: [
    ['{0} stood in front of the bull. On purpose, apparently.', '{0} se le paró enfrente al toro. A propósito, parece.'],
    ['{0} found out why nobody else was standing there', '{0} ya supo por qué nadie más estaba parado ahí'],
  ],
  downLocal: [
    ['{0} brought a gun to a machete fight and still lost', '{0} llevó pistola a una pelea de machetes y aun así perdió'],
    ['{0} got a free haircut', 'A {0} le dieron un corte de pelo gratis'],
  ],
  downRafael: [
    ['A drunk Rafael put {0} to bed', 'Un Rafael borracho mandó a dormir a {0}'],
    ['{0} got hit with the good vodka', 'A {0} le pegaron con el vodka del bueno'],
    ['{0} touched the coconuts', '{0} tocó los cocos'],
  ],
  bled: [
    ['{0} bled out', '{0} se desangró'],
    ['{0} bled out waiting for someone, anyone', '{0} se desangró esperando a alguien, a quien fuera'],
    ['{0} is watching from the afterlife now', '{0} ahora ve todo desde el más allá'],
    ['{0} bled out. Thanks, team.', '{0} se desangró. Gracias, equipo.'],
  ],
  revive: [
    ['{0} revived {1}', '{0} revivió a {1}'],
    ['{0} dragged {1} back to work', '{0} regresó a {1} a trabajar'],
    ['{0} saved {1}. {1} owes {0} a beer.', '{0} salvó a {1}. {1} le debe una cerveza a {0}.'],
  ],
  reviveAgain: [
    ['{0} revived {1} (again)', '{0} revivió a {1} (otra vez)'],
    ['{0} revived {1}. This is becoming a habit.', '{0} revivió a {1}. Ya se está haciendo costumbre.'],
  ],
  toy: [
    ['{0} got a toy cow out of the box. Adorable.', 'A {0} le salió una vaquita de juguete. Qué ternura.'],
    ['{0} gambled and won a stuffed animal', '{0} apostó y se ganó un peluche'],
  ],
  ram: [
    ['{0} is mowing the lawn with the truck', '{0} está podando el pasto con la troca'],
    ['{0}: five cows, one bumper', '{0}: cinco vacas, una defensa'],
  ],
};

// What a character says (shown as  Name: "line"). `any` is everyone's; a character id adds
// that person's own lines, which are used most of the time when they exist.
const LINES = {
  down: {
    any: [
      ["I'm fine. I'm on the floor, but I'm fine.", 'Estoy bien. Estoy en el suelo, pero estoy bien.'],
      ['A little help? No rush. Actually, rush.', '¿Me ayudan? Sin prisa. Bueno, sí, con prisa.'],
      ['That cow cheated.', 'Esa vaca hizo trampa.'],
      ["Tell my family... oh wait, you're all here.", 'Díganle a mi familia... ah, si aquí están todos.'],
    ],
    p1: [ // Troy
      ['Not the hat.', 'El sombrero no.'],
      ['Those were prize Brahmans. WERE.', 'Eran Brahman de exposición. ERAN.'],
    ],
    p4: [ // Rafael
      ['Who left the gate open?! Chingado!', '¡¿Quién dejó el portón abierto?! ¡Chingado!'],
      ["They're after my coconuts. Get up, Rafael.", 'Vienen por mis cocos. Levántate, Rafael.'],
      ['Not on my property.', 'En mi propiedad, no.'],
    ],
  },
  revived: {
    any: [
      ['I was resting my eyes.', 'Nomás estaba descansando los ojos.'],
      ['Nobody saw that, right?', 'Nadie vio eso, ¿verdad?'],
      ['Took you long enough.', 'Ya era hora.'],
    ],
    p1: [['Okay. New plan.', 'Bueno. Plan nuevo.']],
    p4: [
      ["I wasn't down. I was checking the grass.", 'No estaba tirado. Estaba revisando el pasto.'],
      ["Where's my Grey Goose?", '¿Dónde está mi Grey Goose?'],
    ],
  },
  perk: {
    any: [
      ["Tastes like regret. I'll have another.", 'Sabe a arrepentimiento. Dame otra.'],
      ['Is this even cold?', '¿Esto siquiera está frío?'],
      ["I feel faster. Or it's the sugar.", 'Me siento más veloz. O es el azúcar.'],
    ],
    p1: [['This is a business expense.', 'Esto es gasto del negocio.']],
    p4: [
      ['This is not Grey Goose.', 'Esto no es Grey Goose.'],
      ["Put it on the ranch's tab.", 'Apúntalo a la cuenta del rancho.'],
    ],
  },
  toy: {
    any: [
      ['I wanted a gun.', 'Yo quería un arma.'],
      ["It's kind of cute, though.", 'Pero sí está bonita.'],
    ],
    p4: [['I paid for a cow and got a toy. Typical.', 'Pagué por una vaca y me dieron un juguete. Típico.']],
  },
};

// End-of-game awards: [title, what they did ({0} is the number)].
const AWARDS = {
  kills: [['Top Rancher', 'Mejor Ranchero'], ['{0} kills', '{0} bajas']],
  heads: [['Sharpshooter', 'Tirador Fino'], ['{0} headshots', '{0} tiros a la cabeza']],
  downs: [['Floor Inspector', 'Inspector de Pisos'], ['went down {0} times', 'cayó {0} veces']],
  revives: [['Guardian Angel', 'Ángel de la Guarda'], ['revived teammates {0} times', 'revivió compañeros {0} veces']],
  spray: [['Spray and Pray', 'A Ver Si Pega'], ['{0}% of shots hit something', 'el {0}% de sus tiros le dio a algo']],
  ram: [['Road Rage', 'Furia al Volante'], ['{0} cows under the truck', '{0} vacas bajo la troca']],
  toys: [['Toy Collector', 'Coleccionista de Juguetes'], ['toy cows won: {0}', 'vaquitas de juguete ganadas: {0}']],
  spent: [['Big Spender', 'Manos Sueltas'], ['spent ${0}', 'gastó ${0}']],
  hiding: [['Pepper Award for Hiding', 'Premio Pepper por Esconderse'], ['fired {0} shots all game', 'disparó {0} veces en todo el juego']],
};

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function quip(kind) { return rnd(QUIPS[kind])[0]; }

export function line(kind, char) {
  const own = LINES[kind][char];
  return rnd(own && Math.random() < 0.7 ? own : LINES[kind].any)[0];
}

export const newStats = () => ({ downs: 0, revives: 0, shots: 0, hits: 0, heads: 0, ram: 0, toys: 0, spent: 0 });

// players: [{ name, kills, st }]. One winner per award; an award nobody earned is left out.
export function awards(players) {
  const out = [];
  const give = (key, value, min, lowest = false) => {
    let best = null;
    for (const p of players) {
      const v = value(p);
      if (v == null || (!lowest && v < min)) continue;
      if (!best || (lowest ? v < best.v : v > best.v)) best = { p, v };
    }
    if (best) out.push({ k: AWARDS[key][0][0], d: AWARDS[key][1][0], n: best.p.name, v: best.v });
  };
  give('kills', p => p.kills, 2);
  give('heads', p => p.st.heads, 2);
  give('revives', p => p.st.revives, 2);
  give('downs', p => p.st.downs, 2);
  give('ram', p => p.st.ram, 2);
  give('spray', p => (p.st.shots >= 30 ? Math.round((p.st.hits / p.st.shots) * 100) : null), 0, true);
  give('toys', p => p.st.toys, 1);
  give('spent', p => p.st.spent, 1500);
  if (players.length > 1) give('hiding', p => p.st.shots, 0, true);
  return out.slice(0, 6);
}

// English -> Spanish for everything above
export const BANTER_ES = {};
for (const group of Object.values(QUIPS)) for (const [en, es] of group) BANTER_ES[en] = es;
for (const kind of Object.values(LINES)) for (const group of Object.values(kind)) for (const [en, es] of group) BANTER_ES[en] = es;
for (const pair of Object.values(AWARDS)) for (const [en, es] of pair) BANTER_ES[en] = es;

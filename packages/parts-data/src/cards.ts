// Library card text (PART_SYSTEM §6, UI_UX §4.4): plain-English Needs / Does plus one or two tips,
// for every part and for the link kinds that have their own Library entry. English source strings
// (i18n keys come later). Describe only what the sim does today: when a behaviour lands, its card
// line lands with it.

import { CRITTER_CARDS } from './critters.ts';
import { CARDS_M3 } from './defs_m3.ts';
import { CARDS_M4 } from './defs_m4.ts'; // A4
import { CARDS_M5 } from './defs_m5.ts'; // A5
import { CARDS_M5_MATTER } from './defs_m5_matter.ts'; // X5

export interface Card {
  /** What it needs to do its thing (≤ 60 chars). */
  readonly needs: string;
  /** What it does (≤ 90 chars). */
  readonly does: string;
  /** One or two short tips. */
  readonly tips: readonly string[];
}

export const CARDS: Readonly<Record<string, Card>> = {
  // ---- Rollers ----------------------------------------------------------------------------------
  thud: {
    needs: 'Nothing: drop it, roll it or knock it',
    does: 'A 7 kg ball that barely bounces and knocks most things over',
    tips: ['Heavy enough to press THE BUTTON or any STOMP PAD.', 'Roll it down a SLOPE to get it moving.'],
  },
  boing: {
    needs: 'Nothing: drop it or roll it',
    does: 'A light rubber ball that bounces back up most of the way',
    tips: ['At 0.6 kg it won’t press a STOMP PAD set heavier than that.'],
  },
  stitch: {
    needs: 'Nothing: drop it or roll it',
    does: 'A small, hard 0.15 kg ball with a lively bounce',
    tips: ['Small enough to slip through gaps the big balls can’t.'],
  },
  helio: {
    needs: 'Nothing: it floats up on its own',
    does: 'Floats up and tugs on its LINE; pops on sharp or hot things or a hard hit',
    tips: ['COG teeth, SNIPPER blades, flames and blasts all pop it.', 'Tie it to a FULCRUM end to lift it.'],
  },
  // ---- Frame ------------------------------------------------------------------------------------
  brik: {
    needs: 'Nothing: lay them in rows',
    does: 'Bricks laid face to face are mortared together until a hard hit or blast cracks them',
    tips: ['Lower the Mortar setting for walls that crumble easily.'],
  },
  plank: {
    needs: 'Nothing; a flame to set it burning',
    does: 'A 1 m wooden beam: snaps on a hard hit, catches fire and burns through',
    tips: ['It takes 4 s in a flame to catch, then breaks in two after 6 s.', 'A burning plank lights things around it.'],
  },
  slope: {
    needs: 'Nothing: it stays where you put it',
    does: 'A fixed ramp that sends balls rolling downhill',
    tips: ['Set the angle from 5° to 60°: steeper is faster.'],
  },
  ledge: {
    needs: 'Nothing: it stays where you put it',
    does: 'A fixed shelf that holds things up, even in mid-air',
    tips: ['Park a THUD on one, ready to be knocked off.'],
  },
  fulcrum: {
    needs: 'A weight on one end, or a pull on an end hook',
    does: 'A seesaw: the beam tips up to 12° each way',
    tips: ['Drop a THUD on one end to fling what sits on the other.', 'Its end hooks take a LINE.'],
  },
  anchor: {
    needs: 'A LINE tied to its hook',
    does: 'A fixed hook point that holds up to four lines',
    tips: ['Tie a HELIO to it to keep the balloon in place.'],
  },
  sheave: {
    needs: 'Two LINEs on its axle',
    does: 'A pulley: two lines on its axle become one rope running over it',
    tips: ['With only one line it acts as a fixed hook.'],
  },
  // ---- Drive ------------------------------------------------------------------------------------
  treadway: {
    needs: 'Spin on a drum, by BAND from a MOTOR',
    does: 'A conveyor belt that carries whatever sits on it while its drum turns',
    tips: ['Faster drum, faster belt.', 'Flip the MOTOR’s direction to run the belt the other way.'],
  },
  cog: {
    needs: 'Spin from a BAND or from a meshed COG',
    does: 'A gear: cogs whose rims touch mesh, turn the opposite way and swap speed for size',
    tips: ['A small cog turns a big one slower.', 'Its teeth pop HELIOs.'],
  },
  motor: {
    needs: 'Power from MAINS by power cable',
    does: 'Spins its shaft at 1.5 turns a second with real torque; set it to CW or CCW',
    tips: ['Too many parts on one MAINS and it slows down.', 'Stall its shaft and it flags a jam.'],
  },
  // ---- Air --------------------------------------------------------------------------------------
  gale: {
    needs: 'Power from MAINS by power cable',
    does: 'A fan: blows a 6 m cone of wind that pushes loose things and blows out candles',
    tips: ['Points the way its front faces.', 'Close up, it blows out a WICK.'],
  },
  // ---- Power and signal -------------------------------------------------------------------------
  mains: {
    needs: 'Nothing; a signal on its input flips it on or off',
    does: 'Powers up to six cables, 500 W shared between everything wired to it',
    tips: ['Turn off “On at start” and wire a BUTTON to switch it on.'],
  },
  stomp_pad: {
    needs: 'Things resting on it at its trigger weight or more',
    does: 'Sends a signal down its cables when it’s pressed',
    tips: ['Set the trigger weight from 0.05 kg to 20 kg.', 'Only things touching the pad count.'],
  },
  the_button: {
    needs: 'Something landing on it, or a click while running',
    does: 'Sends a signal down its cables each time it’s pressed',
    tips: ['Drop a THUD on it to start a machine.'],
  },
  // ---- Fire and boom ----------------------------------------------------------------------------
  wick: {
    needs: 'Nothing: it’s lit at the start (or light it)',
    does: 'A candle: its flame lights fuses, burns through lines and pops balloons',
    tips: ['Stays lit when knocked over; wind puts it out.', 'Wire a FUSE to its flame to carry the fire.'],
  },
  bangstick: {
    needs: 'Fire on its fuse stub, a detonator signal or a nearby blast',
    does: 'BOOM: throws things, cracks walls, snaps lines and sets off other explosives',
    tips: ['Set the fuse from 0.5 s to 5 s.', 'A detonator signal skips the fuse.'],
  },
  // ---- Contraptions -----------------------------------------------------------------------------
  snipper: {
    needs: 'A signal on its input',
    does: 'Snaps its blades shut: cuts every line running through them and pops balloons',
    tips: ['Run the LINE right through the blades.', 'Its blades pop a HELIO that touches them.'],
  },
  // ---- Fun --------------------------------------------------------------------------------------
  topple_tile: {
    needs: 'A push',
    does: 'Dominoes: each tile knocks over the next',
    tips: ['Space them a bit less than their height apart.'],
  },
  // ---- M2 machine parts (stream A) ---------------------------------------------------------------
  fuzz: {
    needs: 'Nothing: drop it or roll it',
    does: 'A small felt ball that grips, rolls rather than slides and bounces softly',
    tips: ['It barely skids, even on a steep SLOPE.'],
  },
  pig_iron: {
    needs: 'Nothing: drop it, roll it or knock it',
    does: 'A 6.5 kg iron ball: small, hard and heavy enough to flatten most things',
    tips: ['Fits through gaps a THUD can’t, with nearly the same punch.'],
  },
  vortex: {
    needs: 'Balls dropped or rolled into the bowl',
    does: 'A funnel: balls spiral down the slippery bowl and drop out of the hole underneath',
    tips: ['Roll balls in sideways to make them spiral.', 'Set it on a LEDGE so balls fall out below.'],
  },
  sprong: {
    needs: 'Something landing on the mat',
    does: 'A trampoline: things bounce off faster than they landed, up to 8 m/s',
    tips: ['A BOING keeps bouncing higher and higher.'],
  },
  scoop: {
    needs: 'A LINE on its handle to hang it, or just set it down',
    does: 'A bucket that catches what falls into it and gets heavier',
    tips: ['A HELIO tied to an empty bucket slowly lifts it.'],
  },
  flap: {
    needs: 'A signal (Signal mode), or weight on it (Passive mode)',
    does: 'A trapdoor: drops open on a signal; in Passive mode it lets things through one way',
    tips: ['A second signal closes it, or set an auto-close time.', 'Rotate it upright to make a door.'],
  },
  dynamo: {
    needs: 'Spin on its axle, by BAND from a MOTOR or TURBINE',
    does: 'Turns spin into up to 300 W of power; the more you draw, the harder it is to turn',
    tips: ['It never gives back more than 60 % of the spin you put in.'],
  },
  turbine: {
    needs: 'Wind on its blades from the front (GALE, PUFFER)',
    does: 'A wind turbine: wind turns its blades and spins its axle',
    tips: ['Band its axle to a COG or a DYNAMO.', 'Aim a GALE straight at its face.'],
  },
  puffer: {
    needs: 'Something hitting the pad on top',
    does: 'Bellows: a hit on the pad puffs air out of the nozzle; harder hits puff harder',
    tips: ['A strong puff blows out a WICK.', 'Puffs spin a TURBINE too.'],
  },
  cell: {
    needs: 'Nothing: it starts charged',
    does: 'A battery: 200 W until it runs flat; the more it powers, the faster it drains',
    tips: ['Set its capacity from 5 s to 120 s at full draw.'],
  },
  suncell: {
    needs: 'Light on its face from a TORCH or LAMP',
    does: 'A solar panel: makes up to 150 W, more the brighter its light',
    tips: ['A LAMP close by, or a TORCH beam straight on, works best.'],
  },
  lamp: {
    needs: 'Power from MAINS, CELL, DYNAMO or SUNCELL',
    does: 'A light bulb that lights up SUNCELLs within 6 m',
    tips: ['Draws 40 W; closer is brighter.'],
  },
  torch: {
    needs: 'A signal to switch it on or off',
    does: 'A flashlight: shines a narrow beam of light where it points',
    tips: ['Point it through a BURNING GLASS to light things.', 'Turn on “On at start” to skip the signal.'],
  },
  burning_glass: {
    needs: 'A light beam through its lens (TORCH)',
    does: 'A magnifier: focuses a beam into a hot spot that lights fuses and candles',
    tips: ['The hot spot sits one focal length past the lens.'],
  },
  toggle: {
    needs: 'Something knocking its lever',
    does: 'A lever switch: each flip sends a signal; while on, power passes through it',
    tips: ['Put it on a power cable to switch things on and off.'],
  },
  ringer: {
    needs: 'Nothing: it counts down from the start',
    does: 'An alarm timer: at zero it rings loudly and sends a signal',
    tips: ['Set it from 1 s to 30 s.', 'The ring startles critters nearby.'],
  },
  delay: {
    needs: 'A signal on its input',
    does: 'Holds every signal for 0.1 s to 30 s, then sends it on',
    tips: ['Chain them to time a sequence of events.'],
  },
  t_plunger: {
    needs: 'Something landing on its handle',
    does: 'A detonator: one push sets off every explosive wired to it, up to 64',
    tips: ['Drop a THUD on the handle.'],
  },
  skyrocket: {
    needs: 'Fire on its fuse (FUSE, WICK, a blast)',
    does: 'A rocket: after its fuse it flies for 2 s the way it points, then falls',
    tips: ['Tilt it to aim.', 'Its exhaust lights fuses and pops balloons.'],
  },
  big_top: {
    needs: 'A ball dropped into the barrel, then fire on its fuse',
    does: 'A circus cannon: fires any ball it holds; heavy balls fly slower',
    tips: ['Set the barrel from 15° to 55° and the power from 1 to 5.'],
  },
  cork_blaster: {
    needs: 'A signal, or a hard pull on its back hook',
    does: 'A pop-gun: fires its cork on a string; the cork pops balloons and presses buttons',
    tips: ['The cork stays tied on: 1.5 m of string.'],
  },
  punchline: {
    needs: 'A signal on its input',
    does: 'A boxing glove that punches 0.5 m out, knocks things flying and pulls back',
    tips: ['It punches along its front (+X): rotate it to aim.'],
  },
  gotcha_box: {
    needs: 'Three crank turns (BAND from a MOTOR) or a whack',
    does: 'A pop-up box: the head springs up and lunges forward to bonk what’s in front',
    tips: ['Leave room in front: that’s where it bonks.'],
  },
  gutter: {
    needs: 'A path: draw it like a TUBE',
    does: 'An open half-pipe that carries balls along its path',
    tips: ['Balls can jump out on tight bends: bank them gently.', 'GUTTER SLIM suits small balls.'],
  },
  // ---- Links ------------------------------------------------------------------------------------
  line: {
    needs: 'Two hooks to tie between (HELIO, ANCHOR, FULCRUM…)',
    does: 'A rope that never stretches past the length you laid it',
    tips: ['Cut it with a SNIPPER; a flame burns it through in 1.5 s.', 'Run it over a SHEAVE to make a pulley.'],
  },
  band: {
    needs: 'Two spin ports: MOTOR shaft, COG axle, TREADWAY drum',
    does: 'A drive belt: the two ends turn together at the same speed',
    tips: ['Loop it from a MOTOR’s shaft to a COG or a TREADWAY drum.'],
  },
  fuse: {
    needs: 'Fire at one end (or anywhere along it)',
    does: 'Burns along its path at 0.2 m/s and lights the BANGSTICK or WICK at its end',
    tips: ['Longer fuse, longer wait: 1 m takes 5 s.', 'Wire it from a WICK’s flame to a BANGSTICK.'],
  },
  cable_signal: {
    needs: 'A sender (BUTTON, STOMP PAD) and a receiver',
    does: 'Carries a signal from a sender to a BANGSTICK, MAINS or SNIPPER',
    tips: ['One sender can feed several receivers at once.'],
  },
  cable_power: {
    needs: 'A MAINS at one end',
    does: 'Carries power from MAINS to a MOTOR or GALE',
    tips: ['Everything wired together shares one MAINS’s 500 W.'],
  },
  // M3 parts and the GLIDEPATH link (stream A3, defs_m3.ts)
  ...CARDS_M3,
  // M4 parts (stream A4, defs_m4.ts)
  ...CARDS_M4,
  // M5 parts (stream A5, defs_m5.ts)
  ...CARDS_M5,
  // GOO VAT (stream X5, defs_m5_matter.ts)
  ...CARDS_M5_MATTER,
  // critters and the critter-bound devices (stream B, critters.ts)
  ...CRITTER_CARDS,
};

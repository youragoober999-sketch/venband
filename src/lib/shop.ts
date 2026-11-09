// The Venband Shop catalog: avatar decorations, profile effects, nameplates,
// themes and bundles. Everything is free — "Get" adds it to your collection.
//
// Pure data (no React), so it's unit-testable (tests/shop.test.ts).
// Item ids: "<kind>.<design>.<variant>", e.g. "deco.kitty_ears.blush".
// Ids without a dot are the original cosmetics everyone already has.
//
// Classics are drawn from PUBLIC-DOMAIN works only (old films, books,
// paintings and myths whose copyright has expired), in Venband's own style.
// Nothing here uses characters, logos or art from works that need a licence.

export type ShopKind = 'decoration' | 'effect' | 'nameplate' | 'theme' | 'bundle';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic';
export interface Palette { id: string; name: string; c: [string, string, string, string] } // main, second, accent, dark

const PAL = (id: string, name: string, a: string, b: string, c: string, d: string): Palette => ({ id, name, c: [a, b, c, d] });
export const PALETTES: Record<string, Palette> = Object.fromEntries(
  [
    PAL('blush', 'Blush', '#ffd6e3', '#ff8fb8', '#ffffff', '#5b2440'),
    PAL('snow', 'Snow', '#f4f6fb', '#c9d3e6', '#ffffff', '#3b4459'),
    PAL('ginger', 'Ginger', '#ffb26b', '#ff7a2f', '#fff1dd', '#5a2a10'),
    PAL('midnight', 'Midnight', '#3a3f5c', '#1b1e30', '#9aa7ff', '#05060d'),
    PAL('mint', 'Mint', '#b8f5da', '#3fd6a0', '#effff8', '#0d3b2c'),
    PAL('lilac', 'Lilac', '#e3d4ff', '#a98bff', '#ffffff', '#2b1d52'),
    PAL('gold', 'Gold', '#ffe08a', '#e0a526', '#fff7d6', '#5a3b00'),
    PAL('silver', 'Silver', '#eef1f6', '#9aa3b5', '#ffffff', '#2c3140'),
    PAL('crimson', 'Crimson', '#ff5d6c', '#b3122e', '#ffd0d6', '#2a0309'),
    PAL('ember', 'Ember', '#ffd166', '#ff6b1a', '#fff3c4', '#3a0d00'),
    PAL('frost', 'Frost', '#d9f4ff', '#6cc8ff', '#ffffff', '#0b3550'),
    PAL('toxic', 'Toxic', '#d4ff4f', '#5bd400', '#f4ffd0', '#122b00'),
    PAL('void', 'Void', '#8b5cf6', '#1e1036', '#e9d5ff', '#000000'),
    PAL('ocean', 'Ocean', '#7dd3fc', '#0369a1', '#e0f7ff', '#04263d'),
    PAL('rose', 'Rose', '#ff7aa2', '#c21f5b', '#ffe1ea', '#3d0518'),
    PAL('obsidian', 'Obsidian', '#4b5563', '#111827', '#d1d5db', '#000000'),
    PAL('sakura', 'Sakura', '#ffd3e6', '#ff9cc7', '#fff6fa', '#6a2c47'),
    PAL('sunset', 'Sunset', '#ffb36b', '#ff4f8b', '#ffe6c9', '#3b0a2a'),
    PAL('aurora', 'Aurora', '#5cffc6', '#7b61ff', '#e7fff7', '#071a24'),
    PAL('candy', 'Candy', '#ff9de2', '#7ad7ff', '#fff4fb', '#4a1a5c'),
    PAL('forest', 'Forest', '#9be08a', '#2f8f4e', '#eaffdf', '#0d2a14'),
    PAL('autumn', 'Autumn', '#ffb44d', '#c2410c', '#ffe7c2', '#3a1404'),
    PAL('neon', 'Neon', '#00f0ff', '#ff2bd6', '#ffffff', '#0a0018'),
    PAL('blood', 'Blood Moon', '#ff3b3b', '#5c0010', '#ffb3b3', '#120003'),
    PAL('ivory', 'Ivory', '#fff8e7', '#d9c7a1', '#ffffff', '#4a3b22'),
    PAL('sky', 'Sky', '#bae6fd', '#60a5fa', '#ffffff', '#1e3a8a'),
    PAL('peach', 'Peach', '#ffd9c2', '#ff9f80', '#fff4ec', '#5c2b1a'),
    PAL('ink', 'Ink', '#e5e5e5', '#111111', '#ffffff', '#000000'),
    PAL('emerald', 'Emerald', '#6ef0a0', '#0f9d58', '#e3ffee', '#03301a'),
    PAL('sepia', 'Sepia', '#e8d3a8', '#8a6a3b', '#fff3da', '#2a1c08'),
    PAL('starry', 'Starry', '#f8d548', '#2a4fb5', '#fff6c2', '#0b1640'),
    PAL('wave', 'Indigo Wave', '#e8f1ff', '#1f4e8c', '#ffffff', '#0b1f3b'),
    PAL('scream', 'Scream', '#ff9f43', '#e4572e', '#ffd6a5', '#1d3557'),
    PAL('klimt', 'Gilded', '#f5d06f', '#b8860b', '#fff4c7', '#3b2a00'),
  ].map((p) => [p.id, p]),
);

export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'Common', color: '#9aa3b5' },
  rare: { label: 'Rare', color: '#4ea8ff' },
  epic: { label: 'Epic', color: '#b67bff' },
  legendary: { label: 'Legendary', color: '#ffb02e' },
  mythic: { label: 'Mythic', color: '#ff4f8b' },
};

export const COLLECTIONS = [
  { id: 'cute', name: 'Soft & Cute', blurb: 'Ears, bows, paws and pastel magic.' },
  { id: 'gothic', name: 'Gothic Garden', blurb: 'Thorns, ravens, chains and candlelight.' },
  { id: 'celestial', name: 'Celestial', blurb: 'Halos, moons, eclipses and orbiting worlds.' },
  { id: 'elements', name: 'Elements', blurb: 'Fire, frost, storm and sea.' },
  { id: 'nature', name: 'Wild Bloom', blurb: 'Blossoms, leaves, mushrooms and butterflies.' },
  { id: 'spooky', name: 'After Dark', blurb: 'Ghosts, bones and eyes that watch back.' },
  { id: 'gamer', name: 'Player One', blurb: 'Headsets, pixels, neon and loot.' },
  { id: 'royal', name: 'Royalty', blurb: 'Crowns, laurels and gold.' },
  { id: 'silver_screen', name: 'Silver Screen Classics', blurb: 'Icons of early cinema — films old enough to belong to everyone.', classic: true },
  { id: 'storybook', name: 'Storybook Classics', blurb: 'Legendary books in the public domain, reimagined.', classic: true },
  { id: 'museum', name: 'Museum Masters', blurb: 'Masterpieces whose painters gave them to the world.', classic: true },
  { id: 'myth', name: 'Myths & Legends', blurb: 'Gorgons, serpents, swords and heroes.', classic: true },
  { id: 'originals', name: 'Venband Originals', blurb: 'The first cosmetics — everyone has these.' },
] as const;
export type CollectionId = (typeof COLLECTIONS)[number]['id'];

export interface Product {
  key: string; // "deco.kitty_ears"
  kind: ShopKind;
  base: string;
  name: string;
  desc: string;
  collection: CollectionId;
  rarity: Rarity;
  palettes: string[]; // palette ids (variants)
  /** where a classic comes from (public domain) */
  credit?: string;
  isNew?: boolean;
}
export interface ShopItem {
  id: string;
  kind: ShopKind;
  base: string;
  name: string;
  palette: Palette;
  product: Product;
}

// --------------------------------------------------------------- designs --
type Def = [base: string, name: string, collection: CollectionId, rarity: Rarity, palettes: string, desc: string, credit?: string];
const P = (s: string) => s.split(' ').filter(Boolean);

export const DECORATIONS: Def[] = [
  ['kitty_ears', 'Kitty Ears', 'cute', 'common', 'blush snow ginger midnight lilac mint', 'Fluffy ears that twitch when nobody is looking.'],
  ['bunny_ears', 'Bunny Hop', 'cute', 'common', 'snow blush lilac peach', 'One ear up, one ear flopped. Always listening.'],
  ['fox_ears', 'Fox Fire', 'cute', 'rare', 'ginger snow midnight', 'Sly ears with snowy tips.'],
  ['bow_bell', 'Ribbon & Bell', 'cute', 'rare', 'blush rose lilac sky mint', 'Twin satin bows and a collar bell that jingles.'],
  ['paws', 'Peekaboo Paws', 'cute', 'common', 'peach snow ginger midnight', 'Little paws holding on tight. Toe beans included.'],
  ['hearts_rise', 'Smitten', 'cute', 'rare', 'rose blush lilac crimson', 'Hearts drift up whenever you are around.'],
  ['clouds_rainbow', 'Over the Rainbow', 'cute', 'epic', 'sky candy sunset', 'A rainbow arched between two fluffy clouds.'],
  ['party_hat', 'Party Starter', 'cute', 'common', 'candy sunset mint gold', 'A striped party hat and a sprinkle of confetti.'],
  ['bubbles', 'Bubble Bath', 'cute', 'common', 'sky lilac mint candy', 'Iridescent bubbles that rise and wobble.'],
  ['fuming', 'Fuming', 'cute', 'rare', 'crimson ember toxic', 'Steam, a throbbing anger mark and one very loud “!”.'],

  ['rose_vine', 'Thorned Rose', 'gothic', 'epic', 'crimson rose void ivory', 'A thorny vine winds around you; roses bloom along it.'],
  ['chains_lock', 'Locked In', 'gothic', 'epic', 'silver gold crimson void', 'Heavy chains and a padlock — encrypted, end to end.'],
  ['bat_wings', 'Night Wings', 'gothic', 'legendary', 'void crimson obsidian', 'Leathery wings that stretch and fold.'],
  ['witch_hat', 'Hexed', 'gothic', 'rare', 'void midnight toxic sunset', 'A crooked witch hat trailing stars.'],
  ['candles', 'Candlelight Vigil', 'gothic', 'rare', 'ivory crimson void', 'Flickering candles dripping wax around you.'],

  ['halo_wings', 'Seraph', 'celestial', 'epic', 'gold snow sky rose', 'A golden halo and feathered wings that softly flap.'],
  ['grand_wings', 'Archangel', 'celestial', 'legendary', 'snow gold void crimson', 'Enormous wings, feather by feather.'],
  ['crescent', 'Moon Cradle', 'celestial', 'rare', 'gold lilac frost blood', 'Rest in the curve of a sleepy crescent moon.'],
  ['eclipse', 'Total Eclipse', 'celestial', 'legendary', 'gold ember crimson frost', 'A blazing corona and a diamond-ring flare.'],
  ['orbit', 'Gravity Well', 'celestial', 'epic', 'aurora neon sunset ocean', 'Little worlds in tilted orbits around you.'],
  ['constellation', 'Constellation', 'celestial', 'rare', 'frost gold lilac', 'Stars connect into a shape only you can name.'],

  ['flame_crown', 'Inferno Crown', 'elements', 'epic', 'ember toxic frost void', 'Living flames licking the air, embers rising.'],
  ['lightning', 'Overcharged', 'elements', 'epic', 'frost neon toxic gold', 'Arcing electricity that never stays still.'],
  ['ice_shards', 'Permafrost', 'elements', 'rare', 'frost lilac mint', 'Crystal shards of ancient ice and slow snowflakes.'],
  ['waves', 'Tidebreaker', 'elements', 'rare', 'ocean aurora sunset', 'Rolling waves wrapped around you.'],

  ['flower_crown', 'Flower Crown', 'nature', 'rare', 'sakura sunset lilac ivory', 'A crown of hand-picked blooms.'],
  ['sakura_branch', 'Sakura Branch', 'nature', 'epic', 'sakura snow rose', 'A blossoming branch shedding petals.'],
  ['butterflies', 'Butterfly Ballet', 'nature', 'epic', 'aurora lilac sunset snow', 'Butterflies circling in a slow waltz.'],
  ['autumn_wreath', 'Harvest Wreath', 'nature', 'rare', 'autumn gold forest', 'Maple leaves in fire colours.'],
  ['toadstools', 'Fairy Ring', 'nature', 'rare', 'crimson lilac sky', 'Spotted toadstools and drifting fireflies.'],

  ['ghosts', 'Haunted', 'spooky', 'rare', 'snow lilac mint', 'Three friendly ghosts on an endless loop.'],
  ['watching_eyes', 'All Eyes', 'spooky', 'legendary', 'crimson toxic frost gold', 'Eyes open around you. They blink. They follow.'],
  ['skeleton_grip', 'Bone Grip', 'spooky', 'epic', 'ivory toxic frost', 'A skeletal hand that will not let go.'],

  ['headset', 'Pro Headset', 'gamer', 'common', 'neon midnight crimson mint', 'RGB headset with a live mic glow.'],
  ['pixel_hearts', 'Extra Life', 'gamer', 'common', 'crimson toxic sky', '8-bit hearts — full health.'],
  ['neon_ring', 'Neon Sign', 'gamer', 'rare', 'neon sunset toxic', 'Buzzing neon tubing with a flicker.'],
  ['soundwave', 'Bass Drop', 'gamer', 'rare', 'neon aurora sunset', 'An equaliser pulsing all the way around.'],
  ['stickers', 'Sticker Bomb', 'gamer', 'rare', 'candy neon sunset', 'GG! Stars, bolts and hearts slapped on.'],
  ['katana', 'Last Cut', 'gamer', 'epic', 'crimson frost void', 'A blade with a light trail that splits the air.'],

  ['crown', 'Crown Jewels', 'royal', 'epic', 'gold silver rose', 'A jewelled crown, slightly tilted, always sparkling.'],
  ['laurel', 'Victor’s Laurel', 'royal', 'rare', 'gold silver emerald', 'The wreath of champions.'],

  // ---- public-domain classics (credit says where each one comes from)
  ['moon_voyage', 'Moon Voyage', 'silver_screen', 'mythic', 'sepia ivory', 'A capsule lands right in the Moon’s eye.', 'A Trip to the Moon (Georges Méliès, 1902)'],
  ['shadow_hand', 'Count Orlok’s Shadow', 'silver_screen', 'mythic', 'ink sepia', 'A long-fingered shadow creeping up the stairs.', 'Nosferatu (F. W. Murnau, 1922)'],
  ['caligari', 'Caligari Cabinet', 'silver_screen', 'legendary', 'ink sepia', 'Jagged painted shards from a nightmare set.', 'The Cabinet of Dr. Caligari (Robert Wiene, 1920)'],
  ['opera_ghost', 'Opera Ghost', 'silver_screen', 'legendary', 'gold crimson', 'A crystal chandelier swaying over the stage.', 'The Phantom of the Opera (Gaston Leroux, 1910)'],
  ['deerstalker', 'Baker Street Sleuth', 'storybook', 'legendary', 'sepia ivory', 'A deerstalker cap and a magnifying glass. Elementary.', 'The detective stories of Arthur Conan Doyle (1887–1927)'],
  ['cheshire', 'Cheshire Grin', 'storybook', 'mythic', 'lilac rose', 'A grin that stays after the cat has gone.', 'Alice’s Adventures in Wonderland (Lewis Carroll & John Tenniel, 1865)'],
  ['pocket_watch', 'Late, Late!', 'storybook', 'legendary', 'gold silver', 'A swinging pocket watch and a fan of cards.', 'Alice’s Adventures in Wonderland (1865)'],
  ['top_hat', 'Ten-and-Six', 'storybook', 'legendary', 'emerald sepia', 'A towering hat with its price card still tucked in.', 'Alice’s Adventures in Wonderland (1865)'],
  ['emerald_specs', 'Emerald Spectacles', 'storybook', 'legendary', 'emerald gold', 'In the Emerald City, everyone wears green glasses.', 'The Wonderful Wizard of Oz (L. Frank Baum & W. W. Denslow, 1900)'],
  ['count_castle', 'The Count’s Castle', 'storybook', 'mythic', 'blood void', 'Bats circle a castle under a blood moon.', 'Dracula (Bram Stoker, 1897)'],
  ['prometheus', 'Modern Prometheus', 'storybook', 'mythic', 'toxic frost', 'Stitches, sparks and a crack of lightning. It’s alive.', 'Frankenstein (Mary Shelley, 1818)'],
  ['raven', 'Midnight Dreary', 'storybook', 'mythic', 'void obsidian', 'A raven perched above you, quoting nothing but one word.', 'The Raven (Edgar Allan Poe, 1845)'],
  ['porthole', 'Nautilus Porthole', 'storybook', 'legendary', 'gold ocean', 'Brass rivets, thick glass and bubbles from the deep.', 'Twenty Thousand Leagues Under the Seas (Jules Verne, 1870)'],
  ['parrot_map', 'Captain’s Parrot', 'storybook', 'legendary', 'emerald crimson', 'A parrot on your shoulder and an X on the map.', 'Treasure Island (Robert Louis Stevenson, 1883)'],
  ['puppet_strings', 'Puppet Strings', 'storybook', 'epic', 'sepia crimson', 'A marionette cross swinging overhead.', 'The Adventures of Pinocchio (Carlo Collodi, 1883)'],
  ['dorian_frame', 'Portrait in the Attic', 'storybook', 'mythic', 'gold obsidian', 'A gilded frame that cracks a little more each day.', 'The Picture of Dorian Gray (Oscar Wilde, 1890)'],
  ['potion', 'Two Natures', 'storybook', 'legendary', 'toxic void', 'Bubbling flasks — one for each side of you.', 'Strange Case of Dr Jekyll and Mr Hyde (Robert Louis Stevenson, 1886)'],
  ['starry_ring', 'Starry Swirl', 'museum', 'mythic', 'starry', 'Swirling night sky, painted in thick strokes.', 'The Starry Night (Vincent van Gogh, 1889)'],
  ['great_wave', 'Great Wave', 'museum', 'mythic', 'wave', 'A clawing wave curling over you.', 'The Great Wave off Kanagawa (Katsushika Hokusai, c. 1831)'],
  ['scream_sky', 'Scream Sky', 'museum', 'legendary', 'scream', 'A blood-orange sky that won’t stop moving.', 'The Scream (Edvard Munch, 1893)'],
  ['gold_mosaic', 'Golden Phase', 'museum', 'legendary', 'klimt', 'Spirals and tiles of gold leaf.', 'The golden phase of Gustav Klimt (1899–1910)'],
  ['gorgon', 'Gorgon’s Crown', 'myth', 'mythic', 'emerald toxic gold', 'A crown of living snakes. Don’t look directly at it.', 'Greek myth of Medusa'],
  ['ouroboros', 'Ouroboros', 'myth', 'legendary', 'emerald gold crimson', 'The serpent that eats its own tail, forever.', 'An ancient symbol, older than writing'],
  ['excalibur', 'Sword in the Stone', 'myth', 'legendary', 'frost gold', 'Only the true heir can pull it free.', 'Arthurian legend'],
  ['outlaw_cap', 'Sherwood Outlaw', 'myth', 'epic', 'forest autumn', 'A feathered cap and two crossed arrows.', 'The ballads of Robin Hood'],
];

export const EFFECTS_DEF: Def[] = [
  ['petals', 'Petal Storm', 'nature', 'rare', 'sakura rose ivory autumn', 'Petals tumbling across your profile.'],
  ['snowfall', 'Silent Snow', 'elements', 'common', 'snow frost lilac', 'Soft flakes drifting down at different depths.'],
  ['embers', 'Ashfall', 'elements', 'rare', 'ember crimson toxic', 'Glowing embers rising from below.'],
  ['storm', 'Thunderhead', 'elements', 'epic', 'frost lilac crimson', 'Driving rain and lightning that lights up the card.'],
  ['crows', 'Murder of Crows', 'gothic', 'legendary', 'void obsidian', 'Crows sweep through drifting fog.'],
  ['butterflies', 'Butterfly Garden', 'nature', 'epic', 'aurora sunset lilac', 'Butterflies fluttering by.'],
  ['bats', 'Night Flight', 'gothic', 'epic', 'blood void', 'A swarm of bats in front of a huge moon.'],
  ['wisps', 'Will-o’-Wisps', 'spooky', 'rare', 'frost toxic lilac', 'Ghost lights that wander and fade.'],
  ['fireflies', 'Summer Night', 'nature', 'common', 'toxic gold aurora', 'Fireflies blinking in the dusk.'],
  ['stardust', 'Stardust', 'celestial', 'common', 'gold frost lilac rose', 'Twinkling four-point stars.'],
  ['meteors', 'Meteor Shower', 'celestial', 'rare', 'frost gold neon', 'Streaks of light across a dark sky.'],
  ['nebula', 'Nebula', 'celestial', 'legendary', 'void aurora sunset', 'A slowly breathing cloud of cosmic dust.'],
  ['aurora_veil', 'Aurora Veil', 'celestial', 'epic', 'aurora neon sunset', 'Curtains of light rippling overhead.'],
  ['confetti', 'Confetti Cannon', 'cute', 'common', 'candy sunset gold', 'A celebration that never ends.'],
  ['hearts', 'Heartbeat', 'cute', 'common', 'rose blush crimson', 'Hearts floating upward.'],
  ['bubbles', 'Fizz', 'cute', 'common', 'sky candy mint', 'Bubbles with rainbow sheen.'],
  ['cipher_rain', 'Cipher Rain', 'gamer', 'epic', 'toxic lilac frost', 'Encrypted glyphs falling like rain.'],
  ['blocks', 'Stackdown Fever', 'gamer', 'rare', 'candy neon', 'Blocks falling and clearing — in the background, of course.'],
  ['notes', 'On Repeat', 'gamer', 'common', 'lilac sunset frost', 'Music notes floating out of your profile.'],
  ['hands', 'Reaching Hands', 'spooky', 'mythic', 'ink void', 'Shadow hands rising from below. They want in.'],
  ['dark_eyes', 'In the Dark', 'spooky', 'legendary', 'crimson toxic gold', 'Eyes open in the darkness, blink, and vanish.'],
  ['feathers', 'Fallen Feathers', 'celestial', 'rare', 'snow void gold', 'Feathers drifting down after something flew by.'],
  ['sunbeams', 'Golden Hour', 'celestial', 'rare', 'gold sunset', 'Warm light rays with floating dust.'],
  ['coins', 'Jackpot', 'royal', 'rare', 'gold silver', 'Spinning coins showering down.'],
  ['lava', 'Lava Lamp', 'elements', 'epic', 'ember candy aurora', 'Slow blobs that merge and split.'],
  ['starry_swirl', 'Starry Night', 'museum', 'mythic', 'starry', 'Swirling, painterly night sky with glowing stars.', 'The Starry Night (Vincent van Gogh, 1889)'],
  ['wave_spray', 'Wave Spray', 'museum', 'legendary', 'wave', 'Foam and spray from a giant wave.', 'The Great Wave off Kanagawa (Hokusai, c. 1831)'],
  ['moon_rocket', 'Shot to the Moon', 'silver_screen', 'mythic', 'sepia', 'A capsule arcs across the stars toward a smiling Moon.', 'A Trip to the Moon (Georges Méliès, 1902)'],
  ['silent_film', 'Silent Film', 'silver_screen', 'legendary', 'sepia ink', 'Film grain, scratches and a flickering projector.', 'Early silent cinema (1895–1927)'],
  ['card_shower', 'Off With Their Heads', 'storybook', 'legendary', 'crimson', 'Playing cards tumbling down a rabbit hole.', 'Alice’s Adventures in Wonderland (1865)'],
  ['clocks', 'Mad Tea Time', 'storybook', 'epic', 'gold', 'Pocket watches drifting, every one of them late.', 'Alice’s Adventures in Wonderland (1865)'],
  ['emerald_glow', 'Emerald City', 'storybook', 'legendary', 'emerald', 'Green sparkles and the shimmer of a far-off city.', 'The Wonderful Wizard of Oz (1900)'],
  ['lab_lightning', 'It’s Alive!', 'storybook', 'mythic', 'toxic frost', 'Arcs of lightning crawl between electrodes.', 'Frankenstein (Mary Shelley, 1818)'],
  ['raven_feathers', 'Nevermore', 'storybook', 'mythic', 'void', 'Black feathers falling through the gloom.', 'The Raven (Edgar Allan Poe, 1845)'],
  ['scream_swirl', 'The Scream', 'museum', 'legendary', 'scream', 'Bands of sky twisting in panic.', 'The Scream (Edvard Munch, 1893)'],
  ['constellation', 'Living Constellations', 'celestial', 'epic', 'midnight lilac gold frost', 'Star-beasts wheel across a sky that never repeats.'],
  ['supernova', 'Supernova', 'celestial', 'mythic', 'ember gold void neon', 'A dying star tears itself open in rings of light.'],
  ['blizzard', 'Whiteout', 'elements', 'epic', 'frost snow sky midnight', 'A howling blizzard swallows the pines whole.'],
  ['inferno', 'Inferno', 'elements', 'legendary', 'ember crimson autumn blood', 'A wall of fire, a sky of smoke, and nowhere to run.'],
  ['tide', 'Moon Tide', 'elements', 'rare', 'ocean aurora frost', 'Silver moonlight on four layers of rolling sea.'],
  ['jellyfish', 'Bloom of Jellies', 'nature', 'epic', 'aurora ocean lilac mint', 'Living lanterns pulse through the deep.'],
  ['inkbloom', 'Inkbloom', 'spooky', 'epic', 'ink void crimson silver', 'Rorschach flowers bleed open on wet paper.'],
  ['phantoms', 'Phantom Procession', 'spooky', 'legendary', 'void frost lilac mint', 'The graveyard exhales, and something answers.'],
  ['pixel_pop', 'Pixel Pop', 'gamer', 'epic', 'neon candy toxic aurora', 'A CRT dream of hearts, coins and chiptune stars.'],
  ['candy', 'Sugar Rush', 'cute', 'rare', 'candy sakura blush mint', 'Lollipops, gumdrops and a permanent sprinkle drizzle.'],
  ['leviathan', 'Leviathan', 'myth', 'mythic', 'ocean emerald gold void', 'Something older than maps coils beneath the light.', 'The Leviathan (Book of Job)'],
  ['phoenix', 'Phoenix Rising', 'myth', 'legendary', 'ember gold crimson sunset', 'Ember feathers climb out of the sun.', 'The phoenix of Greek and Egyptian myth'],
];

export const NAMEPLATES_DEF: Def[] = [
  ['gradient', 'Silk', 'originals', 'common', 'sunset aurora candy ocean rose midnight', 'A smooth, slowly shifting gradient.'],
  ['night_sky', 'Night Sky', 'celestial', 'rare', 'midnight lilac frost', 'Stars and a slow-moving moon.'],
  ['eclipse', 'Eclipse', 'celestial', 'epic', 'gold crimson', 'A burning corona on the horizon.'],
  ['petals', 'Petal Drift', 'nature', 'rare', 'sakura rose autumn', 'Petals blowing past your name.'],
  ['rain_glass', 'Rainy Window', 'elements', 'rare', 'frost midnight', 'Rain sliding down a window at night.'],
  ['fire_wall', 'Firewall', 'elements', 'epic', 'ember toxic frost', 'A wall of flame.'],
  ['ocean', 'Deep Blue', 'elements', 'rare', 'ocean aurora', 'Waves and drifting light.'],
  ['snow', 'Snow Day', 'elements', 'common', 'snow frost', 'Snow falling over hills.'],
  ['lightning', 'Static', 'elements', 'epic', 'frost neon lilac', 'Lightning forks across a storm.'],
  ['neon_city', 'Neon District', 'gamer', 'epic', 'neon sunset toxic', 'A skyline buzzing with neon.'],
  ['grid', 'Outrun', 'gamer', 'rare', 'neon sunset', 'A glowing grid racing to the horizon.'],
  ['cipher', 'Encrypted', 'gamer', 'epic', 'toxic lilac', 'Rows of cipher text scrolling past.'],
  ['blocks', 'Stack Attack', 'gamer', 'rare', 'candy neon', 'Falling blocks in the background.'],
  ['equalizer', 'Equalizer', 'gamer', 'common', 'neon aurora sunset', 'Bars bouncing to the beat.'],
  ['butterflies', 'Flutter', 'nature', 'rare', 'aurora lilac', 'Butterflies drifting across.'],
  ['forest_fog', 'Misty Pines', 'nature', 'rare', 'forest midnight', 'Pines fading into fog.'],
  ['hearts', 'Lovestruck', 'cute', 'common', 'rose blush', 'Hearts bubbling up.'],
  ['clouds', 'Daydream', 'cute', 'common', 'sky candy sunset', 'Puffy clouds sailing by.'],
  ['leopard', 'Snow Leopard', 'cute', 'epic', 'snow gold ink', 'Soft rosettes with a glittering sheen.'],
  ['roses', 'Dark Roses', 'gothic', 'epic', 'crimson void', 'Roses and thorns in moonlight.'],
  ['crows', 'Crowfall', 'gothic', 'legendary', 'void obsidian', 'Crows crossing a grey sky.'],
  ['eyes', 'Watched', 'spooky', 'legendary', 'crimson toxic', 'Eyes blinking in the dark.'],
  ['ghosts', 'Haunting', 'spooky', 'rare', 'lilac mint', 'Ghosts floating through.'],
  ['gold_leaf', 'Gilded Age', 'royal', 'epic', 'gold silver', 'Gold leaf and glints.'],
  ['starry_night', 'Starry Night', 'museum', 'mythic', 'starry', 'Van Gogh-style swirls behind your name.', 'The Starry Night (Vincent van Gogh, 1889)'],
  ['great_wave', 'Great Wave', 'museum', 'mythic', 'wave', 'Curling waves in woodblock style.', 'The Great Wave off Kanagawa (Hokusai, c. 1831)'],
  ['gold_mosaic', 'Gold Mosaic', 'museum', 'legendary', 'klimt', 'Spirals and squares of gold leaf.', 'The golden phase of Gustav Klimt (1899–1910)'],
  ['scream', 'Scream Sky', 'museum', 'legendary', 'scream', 'Swirling orange sky over a dark fjord.', 'The Scream (Edvard Munch, 1893)'],
  ['moon_voyage', 'Moon Voyage', 'silver_screen', 'mythic', 'sepia', 'A smiling Moon and a capsule in flight.', 'A Trip to the Moon (Georges Méliès, 1902)'],
  ['film_reel', 'Silent Film', 'silver_screen', 'legendary', 'sepia ink', 'Sprocket holes, grain and flicker.', 'Early silent cinema (1895–1927)'],
  ['brick_road', 'Yellow Brick Road', 'storybook', 'legendary', 'emerald gold', 'The road winding to the Emerald City.', 'The Wonderful Wizard of Oz (1900)'],
  ['wonderland', 'Down the Rabbit Hole', 'storybook', 'legendary', 'crimson lilac', 'Cards and clocks falling forever.', 'Alice’s Adventures in Wonderland (1865)'],
  ['castle', 'Castle Dracula', 'storybook', 'mythic', 'blood void', 'Bats around towers under a red moon.', 'Dracula (Bram Stoker, 1897)'],
  ['deep_sea', 'Twenty Thousand Leagues', 'storybook', 'legendary', 'ocean gold', 'Bubbles and lights in the deep.', 'Twenty Thousand Leagues Under the Seas (Jules Verne, 1870)'],
  ['constellation', 'Star Chart', 'celestial', 'epic', 'midnight lilac gold frost', 'Star-beasts wheel across a living sky.'],
  ['supernova', 'Supernova', 'celestial', 'mythic', 'ember gold void neon', 'A dying star tears itself open behind your name.'],
  ['blizzard', 'Whiteout', 'elements', 'epic', 'frost snow sky midnight', 'A howling blizzard swallows the pines whole.'],
  ['inferno', 'Inferno', 'elements', 'legendary', 'ember crimson autumn blood', 'A skyline of fire and smoke.'],
  ['tide', 'Moon Tide', 'elements', 'rare', 'ocean aurora frost', 'Silver moonlight over three layers of rolling sea.'],
  ['jellyfish', 'Bloom of Jellies', 'nature', 'epic', 'aurora ocean lilac mint', 'Living lanterns pulse through the deep.'],
  ['inkbloom', 'Inkbloom', 'spooky', 'epic', 'ink void crimson silver', 'Rorschach flowers bleed open on wet paper.'],
  ['phantoms', 'Phantom Procession', 'spooky', 'legendary', 'void frost lilac mint', 'The graveyard exhales, and something answers.'],
  ['pixel_pop', 'Pixel Pop', 'gamer', 'epic', 'neon candy toxic aurora', 'A CRT dream of hearts, coins and chiptune stars.'],
  ['candy', 'Sugar Rush', 'cute', 'rare', 'candy sakura blush mint', 'Lollipops, gumdrops and a permanent sprinkle drizzle.'],
  ['leviathan', 'Leviathan', 'myth', 'mythic', 'ocean emerald gold void', 'Something older than maps coils beneath the light.', 'The Leviathan (Book of Job)'],
  ['phoenix', 'Phoenix Rising', 'myth', 'legendary', 'ember gold crimson sunset', 'Ember feathers climb out of the sun.', 'The phoenix of Greek and Egyptian myth'],
];

/** Official themes: [id, name, collection, rarity, colors: bg, panel, text, accent, (optional) wallpaper gradient] */
type ThemeDef = [string, string, CollectionId, Rarity, string, string, string, string, string?, string?];
export const THEMES_DEF: ThemeDef[] = [
  ['midnight_violet', 'Midnight Violet', 'celestial', 'rare', '#0b0717', '#140d26', '#efe9ff', '#a78bfa'],
  ['deep_ocean', 'Deep Ocean', 'elements', 'rare', '#03121f', '#06213a', '#e2f4ff', '#38bdf8'],
  ['ember_glow', 'Ember Glow', 'elements', 'rare', '#140803', '#24100a', '#ffeedd', '#ff7a2f'],
  ['forest_floor', 'Forest Floor', 'nature', 'rare', '#06120a', '#0e2214', '#e6f7e8', '#4ade80'],
  ['sakura_dream', 'Sakura Dream', 'nature', 'epic', '#1a0c13', '#2a1320', '#ffe8f1', '#ff9cc7', 'linear-gradient(135deg,#2a1320,#3d1a2e 50%,#1a0c13)', 'glass'],
  ['rose_noir', 'Rose Noir', 'gothic', 'epic', '#0e0507', '#1c0a0f', '#ffe1e7', '#ff4d6d'],
  ['blood_moon', 'Blood Moon', 'gothic', 'legendary', '#0a0002', '#1a0306', '#ffd6d6', '#ff2a2a', 'radial-gradient(circle at 80% 10%,#5c0010,#1a0306 45%,#0a0002)', 'glass'],
  ['aurora', 'Aurora', 'celestial', 'legendary', '#04131a', '#08222d', '#e6fffa', '#5cffc6', 'linear-gradient(160deg,#04131a,#0a2a3a 40%,#1b1450 75%,#04131a)', 'glass'],
  ['synthwave', 'Synthwave', 'gamer', 'epic', '#0d0221', '#1a0638', '#ffe6ff', '#ff2bd6', 'linear-gradient(180deg,#0d0221,#2b0a4d 60%,#ff2bd633)', 'glass'],
  ['terminal', 'Terminal', 'gamer', 'rare', '#000a00', '#001400', '#b6ffb6', '#39ff14'],
  ['arctic', 'Arctic', 'elements', 'rare', '#071621', '#0e2433', '#eaf8ff', '#9ee7ff'],
  ['honey', 'Honeycomb', 'nature', 'common', '#140f02', '#221a05', '#fff6db', '#ffc23d'],
  ['lavender_haze', 'Lavender Haze', 'cute', 'rare', '#120d1c', '#1d1530', '#f3ecff', '#c4a7ff'],
  ['cotton_candy', 'Cotton Candy', 'cute', 'epic', '#160d1a', '#22132a', '#fff0fb', '#ff8fd8', 'linear-gradient(135deg,#22132a,#13203a)', 'glass'],
  ['royal_gold', 'Royal Gold', 'royal', 'legendary', '#0f0b03', '#1c1505', '#fff3d1', '#f5c542'],
  ['obsidian', 'Obsidian', 'gothic', 'common', '#050506', '#0d0d10', '#e7e7ea', '#c9c9d1'],
  ['mint_soda', 'Mint Soda', 'cute', 'common', '#04140f', '#08231a', '#e8fff6', '#3fd6a0'],
  ['sunset_strip', 'Sunset Strip', 'elements', 'epic', '#160709', '#2a0e14', '#fff0e6', '#ff8a4c', 'linear-gradient(180deg,#2a0e14,#3d1220 50%,#160709)', 'glass'],
  ['nebula', 'Nebula', 'celestial', 'legendary', '#07051a', '#110c2e', '#efeaff', '#b67bff', 'radial-gradient(circle at 20% 20%,#3b1a6e,#110c2e 50%,#07051a)', 'glass'],
  ['daylight', 'Daylight', 'originals', 'common', '#f4f5f8', '#ffffff', '#111318', '#5b5bf0', undefined, 'light'],
  ['paper', 'Paper', 'storybook', 'rare', '#f6f0e1', '#fffaf0', '#2a2116', '#8a5a2b', undefined, 'light'],
  ['starry_night', 'Starry Night', 'museum', 'mythic', '#0b1640', '#122158', '#fff8d6', '#f8d548', 'radial-gradient(circle at 75% 20%,#f8d54833,transparent 30%),linear-gradient(160deg,#0b1640,#1f3a8a 60%,#0b1640)', 'glass'],
  ['great_wave', 'Great Wave', 'museum', 'mythic', '#0b1f3b', '#12305a', '#f2f7ff', '#e8f1ff', 'linear-gradient(160deg,#0b1f3b,#1f4e8c 70%,#d9c7a1 140%)', 'glass'],
  ['gilded', 'Gilded', 'museum', 'legendary', '#120d02', '#201705', '#fff4c7', '#f5d06f', 'linear-gradient(135deg,#201705,#3b2a00 60%,#120d02)', 'glass'],
  ['silent_film', 'Silent Film', 'silver_screen', 'legendary', '#0c0b09', '#1a1814', '#efe6d2', '#d9c7a1'],
  ['nosferatu', 'Nosferatu', 'silver_screen', 'mythic', '#0a0806', '#16120c', '#e8d9bb', '#b08a4a', 'radial-gradient(ellipse at 50% 0%,#3a2c18,#0a0806 70%)', 'glass'],
  ['emerald_city', 'Emerald City', 'storybook', 'mythic', '#021a0c', '#043018', '#e3ffee', '#34e07a', 'linear-gradient(160deg,#021a0c,#0a4a26 60%,#f5d06f22)', 'glass'],
  ['wonderland', 'Wonderland', 'storybook', 'legendary', '#160a1c', '#24102e', '#fff0fa', '#ff6fb1'],
  ['transylvania', 'Transylvania', 'storybook', 'legendary', '#0a0306', '#170811', '#f3dbe3', '#c2185b'],
  ['nautilus', 'Nautilus', 'storybook', 'legendary', '#021219', '#05202b', '#dff7ff', '#d4a64a'],
];

export const BUNDLES_DEF: [id: string, name: string, collection: CollectionId, rarity: Rarity, items: string, desc: string][] = [
  ['gothic_night', 'Gothic Night', 'gothic', 'legendary', 'deco.rose_vine.crimson effect.crows.void plate.roses.crimson theme.rose_noir', 'Roses, crows and candlelight.'],
  ['soft_kitty', 'Soft Kitty', 'cute', 'epic', 'deco.kitty_ears.blush effect.hearts.blush plate.hearts.blush theme.cotton_candy', 'Everything pink and fluffy.'],
  ['heavenly', 'Heavenly', 'celestial', 'legendary', 'deco.halo_wings.gold effect.feathers.snow plate.clouds.sky theme.daylight', 'Halo, wings and light.'],
  ['eclipse', 'Solar Eclipse', 'celestial', 'legendary', 'deco.eclipse.gold effect.sunbeams.gold plate.eclipse.gold theme.royal_gold', 'When the sun goes dark.'],
  ['blood_moon', 'Blood Moon', 'gothic', 'mythic', 'deco.bat_wings.crimson effect.bats.blood plate.castle.blood theme.blood_moon', 'Wings, bats and a red sky.'],
  ['player_one', 'Player One', 'gamer', 'epic', 'deco.headset.neon effect.blocks.neon plate.grid.neon theme.synthwave', 'Press start.'],
  ['storm_chaser', 'Storm Chaser', 'elements', 'epic', 'deco.lightning.frost effect.storm.frost plate.lightning.frost theme.arctic', 'Chase the lightning.'],
  ['inferno', 'Inferno', 'elements', 'epic', 'deco.flame_crown.ember effect.embers.ember plate.fire_wall.ember theme.ember_glow', 'Everything burns.'],
  ['garden', 'Secret Garden', 'nature', 'epic', 'deco.flower_crown.sakura effect.petals.sakura plate.petals.sakura theme.sakura_dream', 'In full bloom.'],
  ['haunted', 'Haunted House', 'spooky', 'legendary', 'deco.watching_eyes.crimson effect.dark_eyes.crimson plate.eyes.crimson theme.obsidian', 'Something is watching.'],
  ['van_gogh', 'Starry Night', 'museum', 'mythic', 'deco.starry_ring.starry effect.starry_swirl.starry plate.starry_night.starry theme.starry_night', 'The whole painting, all over your profile.'],
  ['hokusai', 'Great Wave', 'museum', 'mythic', 'deco.great_wave.wave effect.wave_spray.wave plate.great_wave.wave theme.great_wave', 'Woodblock waves.'],
  ['melies', 'A Trip to the Moon', 'silver_screen', 'mythic', 'deco.moon_voyage.sepia effect.moon_rocket.sepia plate.moon_voyage.sepia theme.silent_film', 'Early cinema’s most famous shot.'],
  ['wonderland', 'Wonderland', 'storybook', 'mythic', 'deco.cheshire.lilac effect.card_shower.crimson plate.wonderland.crimson theme.wonderland', 'We’re all mad here.'],
  ['oz', 'Emerald City', 'storybook', 'mythic', 'deco.emerald_specs.emerald effect.emerald_glow.emerald plate.brick_road.emerald theme.emerald_city', 'Follow the road.'],
  ['dracula', 'Count Dracula', 'storybook', 'mythic', 'deco.count_castle.blood effect.bats.blood plate.castle.blood theme.transylvania', 'Listen to them — children of the night.'],
  ['frankenstein', 'Modern Prometheus', 'storybook', 'mythic', 'deco.prometheus.toxic effect.lab_lightning.toxic plate.lightning.neon theme.terminal', 'Give it life.'],
  ['poe', 'The Raven', 'storybook', 'mythic', 'deco.raven.void effect.raven_feathers.void plate.crows.void theme.obsidian', 'Once upon a midnight dreary…'],
  ['nosferatu', 'Nosferatu', 'silver_screen', 'mythic', 'deco.shadow_hand.ink effect.silent_film.sepia plate.film_reel.sepia theme.nosferatu', 'The shadow on the stairs.'],
  ['verne', 'The Deep', 'storybook', 'legendary', 'deco.porthole.gold effect.bubbles.sky plate.deep_sea.ocean theme.nautilus', 'Twenty thousand leagues down.'],
];

/** Everyone owns these from day one (plus every id without a dot). Keep in sync with the migration. */
export const STARTER_ITEMS = [
  'deco.kitty_ears.blush', 'deco.headset.neon', 'deco.halo_wings.gold', 'deco.party_hat.candy',
  'effect.stardust.gold', 'effect.snowfall.snow', 'effect.hearts.rose',
  'plate.gradient.sunset', 'plate.night_sky.midnight', 'plate.equalizer.neon',
  'theme.midnight_violet', 'theme.daylight',
];

// ------------------------------------------------------------ build all --
const KIND_PREFIX: Record<Exclude<ShopKind, 'bundle'>, string> = { decoration: 'deco', effect: 'effect', nameplate: 'plate', theme: 'theme' };
export const PRODUCTS: Product[] = [];
export interface ThemeColors { bg: string; panel: string; text: string; accent: string; wallpaper?: string; mode: 'light' | 'glass' | 'dark' }
const THEME_COLORS = new Map<string, ThemeColors>();
export const ITEMS = new Map<string, ShopItem>();
const NEW_BASES = new Set(['moon_voyage', 'starry_ring', 'great_wave', 'cheshire', 'count_castle', 'raven', 'watching_eyes', 'eclipse', 'grand_wings', 'chains_lock', 'constellation', 'supernova', 'blizzard', 'inferno', 'tide', 'jellyfish', 'inkbloom', 'phantoms', 'pixel_pop', 'candy', 'leviathan', 'phoenix']);
function addDefs(kind: Exclude<ShopKind, 'bundle' | 'theme'>, defs: Def[]) {
  for (const [base, name, collection, rarity, pals, desc, credit] of defs) {
    const key = `${KIND_PREFIX[kind]}.${base}`;
    const product: Product = { key, kind, base, name, desc, collection, rarity, palettes: P(pals), credit, isNew: NEW_BASES.has(base) };
    PRODUCTS.push(product);
    for (const pid of product.palettes) {
      const palette = PALETTES[pid];
      if (!palette) throw new Error(`unknown palette ${pid} in ${key}`);
      ITEMS.set(`${key}.${pid}`, { id: `${key}.${pid}`, kind, base, name, palette, product });
    }
  }
}
addDefs('decoration', DECORATIONS);
addDefs('effect', EFFECTS_DEF);
addDefs('nameplate', NAMEPLATES_DEF);
for (const [id, name, collection, rarity, bg, panel, text, accent, wallpaper, mode] of THEMES_DEF) {
  const product: Product = { key: `theme.${id}`, kind: 'theme', base: id, name, desc: mode === 'light' ? 'A light theme.' : mode === 'glass' ? 'Frosted glass over a painted wallpaper.' : 'A dark theme.', collection, rarity, palettes: [] };
  const credit = [...DECORATIONS, ...EFFECTS_DEF, ...NAMEPLATES_DEF].find((d) => d[2] === collection && d[6] && (d[1] === name || d[0] === id))?.[6];
  if (credit) product.credit = credit;
  PRODUCTS.push(product);
  ITEMS.set(product.key, { id: product.key, kind: 'theme', base: id, name, palette: PAL(id, name, accent, panel, text, bg), product });
  THEME_COLORS.set(product.key, { bg, panel, text, accent, wallpaper, mode: (mode as 'light' | 'glass' | undefined) ?? 'dark' });
}
export interface BundleInfo { id: string; name: string; collection: CollectionId; rarity: Rarity; items: string[]; desc: string }
export const BUNDLES: BundleInfo[] = BUNDLES_DEF.map(([id, name, collection, rarity, items, desc]) => ({ id: `bundle.${id}`, name, collection, rarity, items: P(items), desc }));
for (const b of BUNDLES) {
  const product: Product = { key: b.id, kind: 'bundle', base: b.id, name: b.name, desc: b.desc, collection: b.collection, rarity: b.rarity, palettes: [] };
  PRODUCTS.push(product);
  ITEMS.set(b.id, { id: b.id, kind: 'bundle', base: b.id, name: b.name, palette: PALETTES.gold, product });
}

// ------------------------------------------------- owner-only "Special" set --
// Not sold in the Shop and can't be collected: only people with the owner
// role can equip these (enforced by the database, see 20261106160000).
export const SPECIAL_PALETTE: Palette = PAL('owner', 'Sovereign', '#ffd56b', '#7c3aed', '#fff4cc', '#0a0016');
export const SPECIAL_ITEMS = ['deco.sovereign.owner', 'effect.sovereign.owner', 'plate.sovereign.owner', 'theme.sovereign'] as const;
export const SPECIAL_NAME_EFFECT = 'sovereign';
for (const [id, kind, name, desc] of [
  ['deco.sovereign.owner', 'decoration', 'Sovereign Halo', 'Counter-rotating rune rings, a crown of light and orbiting gems around the Venband seal.'],
  ['effect.sovereign.owner', 'effect', 'Genesis', 'A living vortex: the Venband sigil pulses, light pours in, shockwaves ripple out and lightning cracks the edges.'],
  ['plate.sovereign.owner', 'nameplate', 'Throne Room', 'Gold filigree, violet light and drifting sigils behind your name.'],
  ['theme.sovereign', 'theme', 'Sovereign', 'Deep violet and gold, with a glass wallpaper of light.'],
] as const) {
  const product: Product = { key: id, kind, base: 'sovereign', name, desc, collection: 'originals', rarity: 'mythic', palettes: [] };
  ITEMS.set(id, { id, kind, base: 'sovereign', name, palette: SPECIAL_PALETTE, product });
}
THEME_COLORS.set('theme.sovereign', { bg: '#0a0016', panel: '#140829', text: '#fff4dc', accent: '#ffd56b', wallpaper: 'radial-gradient(circle at 50% -10%,#7c3aed66,transparent 55%),radial-gradient(circle at 90% 110%,#ffd56b33,transparent 50%),linear-gradient(160deg,#0a0016,#1a0b38 60%,#0a0016)', mode: 'glass' });
export const isSpecialItem = (id: string) => (SPECIAL_ITEMS as readonly string[]).includes(id);

export function variantsOf(p: Product): ShopItem[] {
  if (p.kind === 'theme' || p.kind === 'bundle') return [ITEMS.get(p.key)!];
  return p.palettes.map((pid) => ITEMS.get(`${p.key}.${pid}`)!);
}
export const bundleOf = (id: string) => BUNDLES.find((b) => b.id === id);
export const itemKind = (id: string): ShopKind | null => ITEMS.get(id)?.kind ?? null;
/** Free for everyone: the originals (no dot), "none", "custom" and the starter set. */
export const isFreeItem = (id: string) => !id.includes('.') || STARTER_ITEMS.includes(id);

export function themeColors(id: string) {
  return THEME_COLORS.get(id) ?? null;
}

export const CATALOG_COUNT = () => ITEMS.size;

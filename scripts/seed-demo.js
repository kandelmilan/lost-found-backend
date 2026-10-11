// Creates demo users and items for local development. Usage: npm run seed:demo
// All demo users share the password "Demo1234". Safe to run more than once. Refuses to run in production.
const sharp = require('sharp');
const env = require('../src/config/env');
const { sequelize, User, Item, ItemImage, Category, Claim, Report } = require('../src/models');
const storage = require('../src/services/storage.service');
const claimService = require('../src/services/claim.service');

const FIRST = ['Aarav', 'Sita', 'Ram', 'Gita', 'Hari', 'Anita', 'Bikash', 'Sunita', 'Rajesh', 'Puja', 'Suman', 'Nisha'];
const LAST = ['Sharma', 'Thapa', 'Gurung', 'Shrestha', 'Karki', 'Rai', 'Tamang', 'Adhikari'];

const PLACES = [
  { area: 'Ratnapark, Kathmandu', lat: 27.7056, lng: 85.3149 },
  { area: 'Thamel, Kathmandu', lat: 27.7154, lng: 85.3123 },
  { area: 'New Road, Kathmandu', lat: 27.7041, lng: 85.3075 },
  { area: 'Baneshwor, Kathmandu', lat: 27.6915, lng: 85.3420 },
  { area: 'Patan Durbar Square, Lalitpur', lat: 27.6727, lng: 85.3253 },
  { area: 'Kalanki, Kathmandu', lat: 27.6935, lng: 85.2817 },
  { area: 'Lakeside, Pokhara', lat: 28.2096, lng: 83.9586 },
];

const ITEMS = [
  ['found', 'wallet', 'Black leather wallet', 'Has some cash and a citizenship card inside.', 'What name is on the card?', 'Ram Thapa'],
  ['lost', 'wallet', 'Lost brown wallet', 'Brown wallet with my license and college ID.'],
  ['found', 'phone', 'Samsung phone with blue cover', 'Found on a micro bus seat. Screen locked.', 'What is the lock screen wallpaper?', 'mountain'],
  ['lost', 'phone', 'iPhone 13 lost', 'Black iPhone with a cracked back. Please contact me.'],
  ['found', 'keys', 'Bunch of keys with red keychain', 'Three keys and a small red Pashupatinath keychain.', 'What colour is the keychain?', 'red'],
  ['lost', 'keys', 'Bike key lost', 'Honda bike key with a black rubber cover.'],
  ['found', 'documents', 'Citizenship certificate found', 'Found near the bus stop. Will only return to the owner.', 'What is the date of birth on it?', '2055-03-12'],
  ['lost', 'documents', 'Lost passport in plastic cover', 'Nepali passport inside a transparent cover.'],
  ['found', 'bag', 'School bag with books', 'Blue school bag, grade 8 books inside.', 'What is the school name on the books?', 'Bal Mandir'],
  ['lost', 'bag', 'Laptop bag lost in taxi', 'Grey laptop bag, Dell charger inside.'],
  ['found', 'pets', 'Brown puppy found', 'Small brown puppy with a red collar, very friendly.', 'What is the puppy’s name?', 'Kale'],
  ['lost', 'pets', 'Our cat is missing', 'White cat with grey tail, answers to Mimi.'],
  ['found', 'electronics', 'Earbuds case found', 'White wireless earbuds case near the cafe.', 'What brand are the earbuds?', 'Oppo'],
  ['lost', 'jewelry', 'Gold ring lost', 'Small gold ring with a red stone. Family gift.'],
  ['found', 'clothing', 'Black jacket left at bus park', 'North Face style black jacket, size M.', 'What is in the left pocket?', 'gloves'],
  ['lost', 'other', 'Umbrella with wooden handle', 'Long black umbrella with a wooden handle.'],
];

const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#4b5563', '#ca8a04'];

async function demoUsers() {
  const passwordHash = await User.hashPassword('Demo1234');
  const users = Array.from({ length: 30 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      name: `${FIRST[i % FIRST.length]} ${LAST[i % LAST.length]}`,
      email: i % 3 === 2 ? null : `demo${n}@example.com`,
      phone: i % 3 === 0 ? null : `+97798000000${n}`,
      password_hash: passwordHash,
      is_blocked: i % 9 === 4,
      is_verified: i % 2 === 0,
      returned_count: i % 4,
      last_login_at: i % 5 === 0 ? null : new Date(Date.now() - i * 3600 * 1000),
    };
  });
  await User.bulkCreate(users, { ignoreDuplicates: true });
  return users.length;
}

async function demoPhoto(color, label) {
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${color}"/>
    <text x="50%" y="50%" font-size="48" font-family="Arial" fill="white" text-anchor="middle" dominant-baseline="middle">${label}</text>
  </svg>`;
  return storage.saveImage('items', await sharp(Buffer.from(svg)).jpeg().toBuffer());
}

async function demoItems() {
  if (await Item.count()) return 0; // only once, so re-running doesn't duplicate posts

  const users = await User.findAll({ where: { role: 'user', is_blocked: false }, order: [['id', 'ASC']], limit: 12 });
  const categories = Object.fromEntries((await Category.findAll()).map((c) => [c.slug, c.id]));
  if (!users.length) throw new Error('No demo users found');

  let created = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const [i, [type, slug, title, description, question, answer]] of ITEMS.entries()) {
      if (round === 1 && i % 2) continue; // second round: fewer items, in other places
      const n = round * ITEMS.length + i;
      const place = PLACES[n % PLACES.length];
      const jitter = () => (Math.random() - 0.5) * 0.01; // ~±500 m
      const daysAgo = n % 20;

      /* eslint-disable no-await-in-loop */
      const item = await Item.create({
        user_id: users[n % users.length].id,
        category_id: categories[slug],
        type,
        title,
        description,
        event_date: new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10),
        area_name: place.area,
        latitude: place.lat + jitter(),
        longitude: place.lng + jitter(),
        secret_question: type === 'found' ? question : null,
        secret_answer_hash: type === 'found' ? await Item.hashAnswer(answer) : null,
        status: n % 11 === 10 ? 'returned' : 'open',
        createdAt: new Date(Date.now() - daysAgo * 86400000),
      });
      if (n % 3 !== 2) {
        const photo = await demoPhoto(COLORS[n % COLORS.length], slug.toUpperCase());
        await ItemImage.create({ item_id: item.id, storage_key: photo.key, url: photo.url, width: photo.width, height: photo.height });
      }
      /* eslint-enable no-await-in-loop */
      created += 1;
    }
  }
  return created;
}

// Answers used for the demo found items above, by title.
const ANSWERS = Object.fromEntries(ITEMS.filter(([type]) => type === 'found').map(([, , title, , , answer]) => [title, answer]));

async function demoClaims() {
  if (await Claim.count()) return 0;

  const users = await User.findAll({ where: { role: 'user', is_blocked: false }, order: [['id', 'DESC']], limit: 10 });
  const items = await Item.findAll({ where: { status: 'open', is_hidden: false }, order: [['id', 'ASC']], limit: 10 });
  const someoneElse = (item, i) => users.find((u, j) => u.id !== item.user_id && j >= i % users.length) || users.find((u) => u.id !== item.user_id);

  let created = 0;
  /* eslint-disable no-await-in-loop */
  for (const [i, item] of items.entries()) {
    const claimer = someoneElse(item, i);
    const poster = await User.findByPk(item.user_id);
    const body = item.type === 'found'
      ? { answer: i % 4 === 3 ? 'not sure' : ANSWERS[item.title] || 'guess', message: 'I think this is mine, I lost it around that day.' }
      : { message: 'I found something that looks like this. It is safe with me.' };
    const claim = await claimService.createClaim(claimer, item.id, body);
    created += 1;

    if (i % 5 === 1) {
      await claimService.accept(poster, claim.id);
      await claimService.updateMeeting(claimer, claim.id, { place: 'Ratnapark police post', at: new Date(Date.now() + 86400000) });
    } else if (i % 5 === 2) {
      await claimService.accept(poster, claim.id);
      await claimService.confirmReturn(claimer, claim.id);
      await claimService.confirmReturn(poster, claim.id);
    } else if (i % 5 === 3) {
      await claimService.reject(poster, claim.id, 'The answer did not match');
    }
  }
  /* eslint-enable no-await-in-loop */
  return created;
}

async function demoReports() {
  if (await Report.count()) return 0;
  const users = await User.findAll({ where: { role: 'user', is_blocked: false }, order: [['id', 'ASC']], limit: 6 });
  const items = await Item.findAll({ where: { is_hidden: false }, order: [['id', 'DESC']], limit: 3 });
  const reports = [
    { target_type: 'item', target_id: items[0].id, reason: 'scam', details: 'The poster asked me to pay Rs 2000 before returning it.' },
    { target_type: 'item', target_id: items[1].id, reason: 'personal_info', details: 'Photo shows a full citizenship number.' },
    { target_type: 'user', target_id: users[5].id, reason: 'fake', details: 'Claims every phone in Thamel is theirs.' },
  ];
  await Report.bulkCreate(reports.map((r, i) => ({ ...r, reporter_id: users[i].id === r.target_id ? users[i + 1].id : users[i].id })));
  return reports.length;
}

async function main() {
  if (env.isProduction) throw new Error('seed:demo must not be run in production');
  const userCount = await demoUsers();
  const itemCount = await demoItems();
  const claimCount = await demoClaims();
  const reportCount = await demoReports();
  console.log(`Demo users ready (${userCount}). Password: Demo1234`);
  console.log(itemCount ? `Created ${itemCount} demo items.` : 'Items already exist — skipped demo items.');
  console.log(claimCount ? `Created ${claimCount} demo claims.` : 'Claims already exist — skipped demo claims.');
  console.log(reportCount ? `Created ${reportCount} demo reports.` : 'Reports already exist — skipped demo reports.');
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());

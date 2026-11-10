import type { Card } from './engine';

/**
 * MODEL BOOTCAMPS: one course per model, everything a salesperson needs to
 * sell that unit: its specs, what comes standard, who it's for, how it stacks
 * up against the models next to it, the price on the lot, the objections and
 * the add-ons. Built from the store's own website listing, the inventory feed
 * and Polaris; prices are as of the date noted (inventory changes).
 */
export interface Course {
  id: string;
  title: string;
  /** One line under the title. */
  blurb: string;
  emoji: string;
  /** The model's spec facts already in the product bank (same topic). */
  specTopic: string;
  /** The course's own facts. */
  cards: Card[];
}

export const COURSE_CAT = 'Model bootcamps';

const R500_SRC = 'https://www.shoalsoutdoorsports.com/Utility-Vehicles-Polaris-Ranger-500-2027-Florence-AL-15e9c125-b85e-428c-a22c-b4ca00fa1801';
const R500_NEWS = 'https://www.polaris.com/en-us/news/product/polaris-introduces-the-all-new-ranger-500/';
const INV = 'Shoals Outdoor Sports – Florence inventory, Nov 2026';

type Section = 'Standard equipment' | 'Who it’s for' | '500 vs 600 vs 1000' | 'Price on the lot' | 'Objections' | 'Add-ons & discovery' | 'Specs';

function r500(id: string, section: Section, kind: Card['kind'], q: string, a: string, why: string, extra: Partial<Card> = {}): Card {
  return { id: `course-r500-27-${id}`, cat: COURSE_CAT, topic: '2027 Polaris Ranger 500', kind, q, a, field: `Ranger 500 · ${section}`, why, src: R500_SRC, ...extra };
}

const ranger500: Course = {
  id: 'ranger-500-2027',
  title: '2027 Polaris Ranger 500',
  blurb: 'The value work Ranger: what it comes with, who it’s for, and how to move them to it (or up from it).',
  emoji: '🛻',
  specTopic: '2027 Polaris Ranger 500',
  cards: [
    /* ---- standard equipment ---- */
    r500('winch', 'Standard equipment', 'choice', 'What winch comes standard on the 2027 Ranger 500?', '2,500 lb. winch with wired remote', 'Factory-installed 2,500 lb. winch with a wired remote, on a steel front bumper with an integrated winch mount.', {
      wrong: ['No winch (it’s an accessory)', '3,500 lb. winch with wireless remote', '4,500 lb. winch'],
    }),
    r500('roof', 'Standard equipment', 'choice', 'Does the 2027 Ranger 500 come with a roof?', 'Yes, a roof is standard', 'Roof is standard (listed under cab components), along with cab nets.', {
      wrong: ['No, the roof is an accessory', 'Only on a Premium trim', 'Only a sport roof on the Crew'],
    }),
    r500('box', 'Standard equipment', 'choice', 'What kind of cargo box does the 2027 Ranger 500 have?', 'Gas-assist dump box with Lock & Ride', 'Gas-assist dump box, 500 lb. rated, with Lock & Ride accessory integration. Bed: 32.6 in. long × 46.2 in. wide × 11.25 in. deep.', {
      wrong: ['Fixed box (no dump)', 'Electric power-dump box', 'Flatbed with stake sides'],
    }),
    r500('wheels', 'Standard equipment', 'choice', 'What wheels come on the 2027 Ranger 500?', '12 in. aluminum', '12 in. aluminum wheels on Carlstar 489 tires: 25 × 8-12 front, 25 × 10-12 rear.', { wrong: ['12 in. steel', '14 in. aluminum', '14 in. steel'] }),
    r500('lights', 'Standard equipment', 'choice', 'What lighting does the 2027 Ranger 500 have?', 'LED headlights and taillights', 'LED headlights and taillights are standard.', { wrong: ['Halogen headlights, LED taillights', 'Halogen headlights and taillights', 'LED headlights only'] }),
    r500('drive', 'Standard equipment', 'choice', 'What drive system does the 2027 Ranger 500 have?', 'All-wheel drive with auto-locking front drive and VersaTrac Turf Mode', 'All-wheel drive with auto-locking front drive and selectable VersaTrac Turf Mode; shaft final drive.', {
      wrong: ['2WD only', 'Selectable 2WD/4WD with a locking rear differential only', 'Full-time 4WD with no Turf Mode'],
    }),
    r500('turf', 'Standard equipment', 'flash', 'What is VersaTrac Turf Mode, and why does a homeowner care?', 'It unlocks the rear differential so the rear wheels can turn at different speeds: tight turns without tearing up the lawn.', 'Selectable VersaTrac Turf Mode is standard on the 500. Great for buyers who drive on their yard, pasture or a golf-course-style lawn.'),
    r500('seat', 'Standard equipment', 'choice', 'What seat does the 2027 Ranger 500 have?', '2-person flip-up bench seat with 3-point harnesses', '2-person capacity, flip-up bench seat with 3-point harness.', { wrong: ['Two bucket seats', '3-person bench', 'Split bench with lap belts'] }),
    r500('gauge', 'Standard equipment', 'choice', 'What gauge does the 2027 Ranger 500 have?', '4 in. LCD rider information center', '4 in. LCD with selectable blue/red backlighting: speedometer, tach, odometer, trip, clock, hour meter, gear and fuel, coolant temp, voltmeter, service intervals, seat-belt reminder. Speed limiting is set in the gauge.', {
      wrong: ['Analog speedometer only', '7 in. Ride Command touchscreen', 'Digital speedometer only (no tach)'],
    }),
    r500('speed', 'Standard equipment', 'flash', 'A parent asks: can I keep my kid from going too fast in the 500?', 'Yes: speed limiting is built in and set from the gauge.', 'The listing includes “speed limiting controlled in gauge.”'),
    r500('hitch', 'Standard equipment', 'choice', 'What hitch comes on the 2027 Ranger 500?', 'Standard 2 in. receiver', 'Standard 2 in. receiver; 1,500 lb. towing.', { wrong: ['1-1/4 in. receiver', 'Ball mount only', 'No hitch (accessory)'] }),
    r500('engine', 'Standard equipment', 'choice', 'What engine is in the 2027 Ranger 500?', '567 cc single-cylinder, 4-stroke DOHC, EFI, liquid-cooled', '567 cc single cylinder, 4-stroke DOHC, electronic fuel injection, liquid cooled: 28 hp.', {
      wrong: ['999 cc twin-cylinder', '570 cc twin, air-cooled, carbureted', '450 cc single, air-cooled'],
    }),
    r500('susp-f', 'Standard equipment', 'type', 'How much front suspension travel does the 2027 Ranger 500 have? (inches)', '9 in.', 'Front: MacPherson strut, 9 in. travel. Rear: dual A-arm IRS, 10 in. travel.', { num: 9, wrong: ['8 in.', '10 in.', '12 in.'] }),
    r500('susp-r', 'Standard equipment', 'type', 'How much rear suspension travel does the 2027 Ranger 500 have? (inches)', '10 in.', 'Rear: dual A-arm independent rear suspension (IRS), 10 in. travel.', { num: 10, wrong: ['9 in.', '11 in.', '12 in.'] }),
    r500('weight', 'Standard equipment', 'type', 'What is the estimated dry weight of the 2027 Ranger 500? (lb.)', '1,155 lb.', 'Estimated dry weight 1,155 lb. (524 kg). Wheelbase 73.2 in., height 74.8 in., turning radius 13.5 ft.', { num: 1155, wrong: ['985 lb.', '1,355 lb.', '1,520 lb.'] }),
    r500('turn', 'Standard equipment', 'type', 'What is the turning radius of the 2027 Ranger 500? (feet)', '13.5 ft.', 'Turning radius 13.5 ft. (4.2 m).', { num: 13.5, wrong: ['12 ft.', '15 ft.', '16.5 ft.'] }),
    r500('brakes', 'Standard equipment', 'choice', 'What brakes does the 2027 Ranger 500 have?', '4-wheel hydraulic disc', '4-wheel hydraulic disc brakes; park is in the transmission (P).', { wrong: ['Front disc, rear drum', 'Single rear disc', 'Mechanical drum brakes'] }),
    r500('steering', 'Standard equipment', 'choice', 'What adjusts on the 2027 Ranger 500’s steering?', 'Tilt steering (no power steering)', 'Tilt adjustment; no electronic power steering on the 500.', { wrong: ['Tilt with power steering (EPS)', 'Nothing (fixed column)', 'Tilt and telescoping with EPS'] }),

    /* ---- who it's for ---- */
    r500('who', 'Who it’s for', 'choice', 'Who is the 2027 Ranger 500 built for?', 'Someone who needs a work-ready UTV (dump box, winch, roof) without breaking the bank', 'Polaris: “With work-ready features like a dump box, factory-installed winch and more, RANGER 500 is the smart choice for those looking to take on to-dos without breaking the bank.”', {
      src: R500_NEWS,
      wrong: ['Trail riders who want the most speed', 'Families who need 3 or more seats', 'Anyone towing more than 2,000 lb.'],
    }),
    r500('pitch', 'Who it’s for', 'flash', 'Give the Ranger 500 in one sentence.', 'A full-size, work-ready Ranger for $9,999: AWD, dump box, 2,500 lb. winch, roof and LED lights all standard; tows 1,500 lb. and hauls 1,000 lb.', 'Lead with what comes standard: the winch and roof are already on it.', { src: INV }),

    /* ---- 500 vs 600 vs 1000 ---- */
    r500('vs600-hp', '500 vs 600 vs 1000', 'choice', 'The 2027 Ranger 600 uses the same 567 cc engine as the 500. How much power does each make?', '500: 28 hp · 600: 44 hp', 'Same 567 cc single; the 600 is tuned to 44 hp vs the 500’s 28 hp. Both: 1,500 lb. towing, 1,000 lb. payload, 500 lb. box, 2 seats, no EPS.', {
      wrong: ['500: 44 hp · 600: 61 hp', 'Both make 28 hp', '500: 28 hp · 600: 61 hp'],
    }),
    r500('vs600-size', '500 vs 600 vs 1000', 'choice', 'Which is narrower, the 2027 Ranger 500 or 600?', 'The 600 (56 in. vs 58.5 in.)', '600: 56 in. wide, 108 in. long, 11 in. clearance. 500: 58.5 in. wide, 110 in. long, 10 in. clearance.', {
      wrong: ['The 500 (56 in. vs 58.5 in.)', 'They’re the same width', 'The 500 (54 in. vs 58.5 in.)'],
    }),
    r500('tow', '500 vs 600 vs 1000', 'choice', 'A customer needs to tow 2,000 lb. Which Ranger?', 'Ranger 1000 (tows 2,500 lb.); the 500 and 600 tow 1,500 lb.', 'Ranger 500 and 600: 1,500 lb. towing. Ranger 1000: 2,500 lb. towing, 1,500 lb. payload, 1,000 lb. box, 61 hp, 3 seats.', {
      wrong: ['Ranger 500 (tows 2,500 lb.)', 'Ranger 600 (tows 2,000 lb.)', 'Any of them, they all tow 2,500 lb.'],
    }),
    r500('seats', '500 vs 600 vs 1000', 'choice', 'A customer needs three seats. Which of these fits?', 'Ranger 1000 (3 seats); the 500 and 600 seat 2', 'Ranger 500 and 600: 2-person bench. Ranger 1000: 3 people.', { wrong: ['Ranger 500', 'Ranger 600', 'All three seat 3'] }),
    r500('payload', '500 vs 600 vs 1000', 'type', 'Ranger 1000 payload is 1,500 lb. What is the Ranger 500’s payload? (lb.)', '1,000 lb.', 'Ranger 500 payload 1,000 lb., box 500 lb. Ranger 1000: payload 1,500 lb., box 1,000 lb.', { num: 1000, wrong: ['800 lb.', '1,250 lb.', '1,500 lb.'] }),
    r500('ladder', '500 vs 600 vs 1000', 'flash', 'Walk the price ladder on our lot: 2027 Ranger 500 → 600 → 1000.', '500: $9,999 · 600: $11,799 (+$1,800 for 44 hp) · 2027 1000: $13,999 (61 hp, 3 seats, 2,500 lb. tow).', 'Prices on our website, Nov 2026. Also in stock: 2026 Ranger 1000 at $11,999 — only $2,000 over the 500 for 61 hp, 3 seats and 2,500 lb. towing. Check current prices before you quote.', { src: INV }),
    r500('step-up', '500 vs 600 vs 1000', 'flash', 'When should you show a customer the 2026 Ranger 1000 instead of the 500?', 'When they need 3 seats, more than 1,500 lb. of towing, or more power: on our lot it’s $11,999, about $2,000 more (Nov 2026).', 'The step-up is real money but a big jump: 61 hp vs 28, 2,500 vs 1,500 lb. towing, 3 seats vs 2. Confirm stock and price first.', { src: INV }),

    /* ---- price on the lot ---- */
    r500('price', 'Price on the lot', 'type', 'What is the 2027 Ranger 500 priced at on our website? (dollars)', '$9,999', 'Website price $9,999, the same as Polaris’s launch MSRP. As of Nov 2026, Florence has them in Stealth Gray.', { num: 9999, src: INV, wrong: ['$8,999', '$10,999', '$11,799'] }),
    r500('color', 'Price on the lot', 'choice', 'What color are the 2027 Ranger 500s in our Florence inventory?', 'Stealth Gray', 'All the Florence 2027 Ranger 500s were Stealth Gray as of Nov 2026.', { src: INV, wrong: ['Sage Green', 'Zenith Blue', 'Onyx Black'] }),
    r500('warranty', 'Price on the lot', 'choice', 'What is the factory warranty on the 2027 Ranger 500?', '1-year limited', 'Factory warranty: 1-year limited.', { wrong: ['6-month limited', '2-year limited', '3-year limited'] }),

    /* ---- objections ---- */
    r500('obj-ps', 'Objections', 'flash', '“It doesn’t have power steering.” What do you say?', 'Agree, then give the choice: the 500 keeps the price at $9,999 with tilt steering. If steering effort matters most, the step is a Ranger 1000 EPS (2026 at $13,499, 2027 at $15,499 on our lot, Nov 2026).', 'Don’t argue a missing feature; show the trade-off and the model that has it.', { src: INV }),
    r500('obj-hp', 'Objections', 'flash', '“28 horsepower isn’t much.” What do you say?', 'It’s built for work, not top speed: AWD, high/low range, 1,500 lb. towing, 1,000 lb. payload. Want more power at the same size? The 600 has 44 hp from the same 567 cc for $1,800 more.', 'Same frame class, same box and towing; the 600 just adds power. Prices as of Nov 2026.', { src: INV }),
    r500('obj-used', 'Objections', 'flash', '“I can find a used one cheaper.” What do you say?', 'New at $9,999 comes with the winch, roof, dump box, aluminum wheels and a factory warranty — and no dealer fees. Price a used one with those added.', 'Make them compare equipped-to-equipped.', { src: INV }),

    /* ---- add-ons & discovery ---- */
    r500('addons', 'Add-ons & discovery', 'flash', 'The 500 already has a roof and winch. What add-ons do buyers usually want next?', 'Weather: windshield, back window or rear panel, side windows or doors. Hauling: Lock & Ride cargo accessories for the dump box.', 'The roof is standard, so finish the cab. Lock & Ride accessory integration is built into the box.'),
    r500('discovery', 'Add-ons & discovery', 'flash', 'What three questions tell you fast whether the 500 is the right Ranger?', '1) What will you tow or haul (over 1,500 lb. → 1000)? 2) How many people ride (3 → 1000)? 3) Mostly chores around the property, or long trail rides?', 'Fits the 500: two people, property work, under 1,500 lb. towing, budget near $10k.'),
  ],
};

export const COURSES: Course[] = [ranger500];

/** Every fact in a course: the model's spec facts from the product bank, then the course's own. */
export function courseIds(course: Course, bank: Card[]): Set<string> {
  return new Set([...bank.filter((c) => c.topic === course.specTopic).map((c) => c.id), ...course.cards.map((c) => c.id)]);
}

export const courseCards = () => COURSES.flatMap((c) => c.cards);

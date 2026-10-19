/* =========================================================================
   CropSentinel AI — Integrated pest & disease management advisory engine
   Produces the seven-section IPM advisory required by the problem statement,
   in English and Marathi.

   Content policy (deliberate):
   • No chemical dose, product guarantee or cure claim is ever generated.
   • Chemical guidance is gated behind "only when the extension officer
     confirms it" and always carries label / PPE / pre-harvest warnings.
   • Every section carries a verification-status tag so a farmer can tell
     general IPM guidance from something that must be confirmed locally.
   ========================================================================= */

import type { ConditionCategory, Lang } from '../domain/types';

export type AdvisorySectionKey =
  | 'immediate'
  | 'prevention'
  | 'cultural'
  | 'biological'
  | 'chemical'
  | 'monitoring'
  | 'referral';

export const ADVISORY_SECTION_ORDER: AdvisorySectionKey[] = [
  'immediate',
  'prevention',
  'cultural',
  'biological',
  'chemical',
  'monitoring',
  'referral',
];

export type Verification = 'general-ipm' | 'needs-local-verification';

export interface AdvisorySection {
  key: AdvisorySectionKey;
  titleKey: string;
  body: string;
  verification: Verification;
  /** Where the guidance comes from — stated so nothing looks authoritative by default. */
  sourceKey: string;
}

export interface Advisory {
  conditionId: string;
  conditionLabel: string;
  sections: AdvisorySection[];
  safetyKeys: string[];
  generatedAt: string;
  locale: Lang;
}

/* ------------------------------------------------------------------ Content */

type L = Record<Lang, string>;

const TITLES: Record<AdvisorySectionKey, string> = {
  immediate: 'advisory.immediate',
  prevention: 'advisory.prevention',
  cultural: 'advisory.cultural',
  biological: 'advisory.biological',
  chemical: 'advisory.chemical',
  monitoring: 'advisory.monitoring',
  referral: 'advisory.referral',
};

/** Category-level IPM templates: six categories × seven sections × three languages. */
const TEMPLATES: Record<ConditionCategory, Record<AdvisorySectionKey, L>> = {
  'disease-fungal': {
    immediate: {
      en: 'Walk the plot today and physically mark every plant showing symptoms. Remove and destroy badly infected leaves or plants away from the field — never compost them inside the plot. Re-photograph the affected part for a second screening before deciding to treat.',
      mr: 'आजच प्लॉटभर फिरून लक्षणे दिसणारे प्रत्येक रोप खुणेने नोंदवा. गंभीर बाधित पाने किंवा रोपे शेताबाहेर काढून नष्ट करा — प्लॉटमध्ये कधीही कंपोस्ट करू नका.',
    },
    prevention: {
      en: 'Keep the canopy open with correct spacing, avoid overhead irrigation late in the day, and remove crop debris after harvest. Use clean seed or certified planting material and avoid planting the same susceptible crop in the same plot in consecutive seasons.',
      mr: 'योग्य अंतर ठेवून पिकांची हवा खेळती ठेवा, संध्याकाळी तुषार सिंचन टाळा आणि काढणीनंतर पीक अवशेष काढून टाका. स्वच्छ बियाणे किंवा प्रमाणित रोपे वापरा.',
    },
    cultural: {
      en: 'Remove the lowest infected leaves first so spores are not splashed upward. Improve drainage, irrigate early in the day so foliage dries before night, and stake or lift the crop off the soil where applicable. Balance nitrogen — heavy nitrogen produces soft, highly susceptible growth.',
      mr: 'सर्वात खालची बाधित पाने आधी काढा. पाण्याचा निचरा सुधारा, सकाळी सिंचन करा जेणेकरून पाने रात्रीपूर्वी वाळतील. नत्र संतुलित ठेवा — जास्त नत्र मऊ व संवेदनशील वाढ निर्माण करते.',
    },
    biological: {
      en: 'Where locally available and recommended, use bio-agents such as Trichoderma-based or Bacillus subtilis preparations, and neem-based products as a supporting measure. Bio-agents work preventively and in rotation; they are not a rescue treatment for a spreading epidemic.',
      mr: 'स्थानिक पातळीवर उपलब्ध असल्यास ट्रायकोडर्मा किंवा बॅसिलस सब्टिलिस आधारित जैविक कारके व कडुनिंब आधारित उत्पादने पूरक उपाय म्हणून वापरा. ही प्रतिबंधात्मक उपाय आहेत, संकटकाळातील उपचार नाहीत.',
    },
    chemical: {
      en: 'Chemical control is justified only if the disease keeps spreading despite the cultural and biological measures above, and only with a product registered for this crop and this problem. Let the extension officer or KVK confirm the product, dose and spray interval. Do not spray the same mode-of-action group in consecutive sprays.',
      mr: 'वर दिलेल्या पीक व्यवस्थापन व जैविक उपायांनंतरही रोग पसरत असेल तरच रासायनिक नियंत्रण न्याय्य आहे. उत्पादन, मात्रा व फवारणी अंतर कृषी अधिकाऱ्यांकडून निश्चित करून घ्या.',
    },
    monitoring: {
      en: 'Re-inspect every 3–4 days in humid, rainy weather and every 7 days in dry weather. Check the lower leaf surface and the newest growth, and record the count of affected plants so the trend is visible.',
      mr: 'दमट व पावसाळी हवामानात दर 3–4 दिवसांनी आणि कोरड्या हवामानात दर 7 दिवसांनी पुन्हा तपासा. बाधित रोपांची संख्या नोंदवा.',
    },
    referral: {
      en: 'Send a sample to the KVK or the state plant-health laboratory if the problem does not improve within 7–10 days, if plants collapse rapidly, or if the symptoms look like a quarantine disease. Never increase pesticide use instead of getting a confirmation.',
      mr: '7–10 दिवसांत सुधारणा न झाल्यास, रोपे झपाट्याने मरत असल्यास किंवा संशयास्पद संसर्गजन्य रोगाची लक्षणे असल्यास नमुना KVK किंवा राज्य वनस्पती आरोग्य प्रयोगशाळेत पाठवा.',
    },
  },
  'disease-bacterial': {
    immediate: {
      en: 'Do not walk through or work in the plot while the foliage is wet — bacteria spread on hands, tools and boots. Uproot and destroy badly affected plants away from the field, and isolate the affected patch so equipment does not move from it to healthy rows.',
      mr: 'पाने ओली असताना प्लॉटमध्ये फिरू किंवा काम करू नका — जिवाणू हात, अवजारे व बूटांद्वारे पसरतात. गंभीर बाधित रोपे काढून नष्ट करा.',
    },
    prevention: {
      en: 'Use certified disease-free seed or planting material, grow a resistant variety where one is available, and avoid moving irrigation water from an affected plot to a healthy one. Clean and disinfect implements between plots.',
      mr: 'प्रमाणित रोगमुक्त बियाणे किंवा रोपे वापरा, प्रतिकारक जात असल्यास वापरा आणि बाधित प्लॉटचे पाणी निरोगी प्लॉटला वळवू नका. अवजारे निर्जंतुक करा.',
    },
    cultural: {
      en: 'Drain standing water, avoid clipping or transplanting during wet weather, destroy stubble and volunteer plants, and rotate to a non-host crop for at least one season. Apply nitrogen in splits rather than a single heavy dose.',
      mr: 'साचलेले पाणी काढा, ओल्या हवामानात काढणी/लागवड टाळा, पीक अवशेष नष्ट करा आणि किमान एक हंगाम वेगळे पीक घ्या.',
    },
    biological: {
      en: 'Soil or seed treatment with Pseudomonas fluorescens is used in several state packages for bacterial problems; use it only if it is recommended for your crop locally. Bio-control supports the plant, it does not cure an established infection.',
      mr: 'स्युडोमोनास फ्लोरेसेन्स माती/बियाणे प्रक्रिया काही राज्य शिफारशींमध्ये आहे; तुमच्या पिकासाठी स्थानिक शिफारस असल्यासच वापरा.',
    },
    chemical: {
      en: 'Copper-based formulations are sometimes used against bacterial diseases; whether to use one, and in what sequence, must be decided by the extension officer for your crop and district. Do not use antibiotics intended for humans or animals on crops — that is both illegal and a public-health risk.',
      mr: 'तांब्याच्या संयुगांचा वापर जिवाणूजन्य रोगांसाठी कधी होतो; तो करायचा का आणि कोणत्या क्रमाने हे कृषी अधिकाऱ्यांनी ठरवावे. मानवी/पशु अँटिबायोटिक पिकांवर वापरणे बेकायदेशीर व धोकादायक आहे.',
    },
    monitoring: {
      en: 'Scout every 2–3 days during rainy and windy spells, when bacterial spread is fastest. Mark new infections on a map or a sketch of the plot to see whether the patch is holding or expanding.',
      mr: 'पाऊस व वाऱ्याच्या काळात दर 2–3 दिवसांनी पाहणी करा आणि नवीन बाधित क्षेत्रे खुणेने नोंदवा.',
    },
    referral: {
      en: 'A bacterial diagnosis cannot be confirmed from a photograph alone. Send a leaf or stem sample for laboratory testing — the two problems look very similar in the field but need different management.',
      mr: 'फोटोवरून जिवाणूजन्य निदान निश्चित करता येत नाही. पान किंवा खोडाचा नमुना प्रयोगशाळेत तपासणीसाठी पाठवा.',
    },
  },
  'disease-viral': {
    immediate: {
      en: 'There is no direct cure for a virus infection. Immediately uproot and destroy plants with clear symptoms so they stop acting as a source, and do not save seed or planting material from an affected plant or plot.',
      mr: 'विषाणू संसर्गावर थेट उपचार नाही. स्पष्ट लक्षणे असलेली रोपे लगेच काढून नष्ट करा आणि बाधित रोपापासून बियाणे घेऊ नका.',
    },
    prevention: {
      en: 'Use certified virus-free seed, grow a resistant or tolerant variety, and avoid planting next to an already infected field. Keep a two-to-three week sowing window away from neighbouring crops of the same family.',
      mr: 'विषाणूमुक्त प्रमाणित बियाणे वापरा, प्रतिकारक/सहनशील जात वापरा आणि बाधित शेताजवळ लागवड टाळा.',
    },
    cultural: {
      en: 'Remove weed hosts and volunteer plants that shelter the vector insect, use a border or trap crop, and consider reflective or straw mulch to reduce vector landing. Rogue out symptoms early — every week matters with a virus.',
      mr: 'विषाणू वाहक कीटकांना आश्रय देणारी तणे व स्वयंउगवलेली रोपे काढा, सीमा/सापळा पीक वापरा. लक्षणे लवकर काढून टाका.',
    },
    biological: {
      en: 'Conserve natural enemies of the vector — ladybird beetles, predatory bugs and spiders — by avoiding broad-spectrum sprays. Neem-based preparations and approved bio-pesticides can support vector suppression where locally recommended.',
      mr: 'वाहक कीटकांचे नैसर्गिक शत्रू — सोनपाखरे, भक्षक कीटक, कोळी — यांना जपा आणि व्यापक-कृती कीटकनाशके टाळा. कडुनिंब आधारित उत्पादने पूरक ठरतात.',
    },
    chemical: {
      en: 'Chemical sprays can only target the vector, not the virus, and they often make things worse by killing the natural enemies that were suppressing it. Spray only when scouting shows vector numbers building up, and never spray insecticide during peak flowering.',
      mr: 'रासायनिक फवारणी विषाणूवर नाही तर वाहकावर परिणाम करते आणि नैसर्गिक शत्रू मारून परिस्थिती बिघडवू शकते. वाहक वाढल्यासच फवारा आणि फुलोऱ्यात कीटकनाशक टाळा.',
    },
    monitoring: {
      en: 'Check the vector population weekly with yellow sticky traps or by counting insects on 10 plants at five spots. Watch especially through warm dry spells, when vectors multiply fastest.',
      mr: 'पिवळ्या चिकट सापळ्यांनी किंवा 10 रोपांवरील कीटक मोजून साप्ताहिक पाहणी करा. उष्ण कोरड्या काळात विशेष लक्ष द्या.',
    },
    referral: {
      en: 'Confirming a virus needs a laboratory test (ELISA or PCR). If several plants in a row are showing mosaic or puckering, ask the KVK to test a sample before you spend money on sprays.',
      mr: 'विषाणू निश्चित करण्यासाठी प्रयोगशाळा चाचणी (ELISA किंवा PCR) आवश्यक आहे. अनेक रोपे बाधित असल्यास फवारणीवर खर्च करण्यापूर्वी KVK कडून नमुना तपासा.',
    },
  },
  pest: {
    immediate: {
      en: 'Confirm the pest and its stage before acting: check the growing point, the lower leaf surface and the fruit or boll, and look for larvae versus beneficial insects. In small plots, hand-picking and destroying egg masses and larvae is often the fastest first response.',
      mr: 'कृती करण्यापूर्वी कीटक व त्याची अवस्था निश्चित करा: वाढीचा शेंडा, पानाचा खालचा भाग व फळ/बोंड तपासा आणि अळ्या व मित्रकीटक वेगळे ओळखा. लहान प्लॉटमध्ये अळ्या हाताने गोळा करून नष्ट करणे हा जलद उपाय आहे.',
    },
    prevention: {
      en: 'Practise field sanitation, destroy crop residues that carry over larvae or pupae, rotate crops, and use a trap crop around the plot. Install pheromone or light traps early enough to detect the arrival of the pest rather than its damage.',
      mr: 'शेत स्वच्छता, अळ्या/कोशांचे वाहक ठरणारे पीक अवशेष नष्ट करा, पीक फेरपालट करा व सापळा पीक वापरा. कीटकाचे आगमन लवकर ओळखण्यासाठी सापळे वेळेवर लावा.',
    },
    cultural: {
      en: 'Use mechanical collection of larvae and egg masses, light traps and sticky traps, keep the field free of alternate weed hosts, sow on the recommended date for your district, and avoid excessive nitrogen which attracts sucking pests.',
      mr: 'अळ्या व अंडी हाताने गोळा करा, प्रकाश सापळे व चिकट सापळे वापरा, पर्यायी तण-यजमान काढा आणि जास्त नत्र टाळा.',
    },
    biological: {
      en: 'Protect parasitoid wasps, lady beetles, lacewings and spiders. Where locally recommended and available, use Trichogramma cards, Bacillus thuringiensis or entomopathogenic fungi such as Beauveria and Metarhizium, rotated with neem-based products.',
      mr: 'परजीवी भुंगे, सोनपाखरे व कोळी जपा. स्थानिक शिफारस असल्यास ट्रायकोग्रामा कार्ड, बॅसिलस थुरिंजिएन्सिस किंवा ब्युव्हेरिया / मेटारायझियम यांसारखी बुरशीनाशके कडुनिंबासोबत फिरवून वापरा.',
    },
    chemical: {
      en: 'Insecticide is justified only when your own scouting count is above the locally validated action threshold for this crop and pest — never on a calendar schedule. Rotate modes of action so resistance does not build, do not spray flowering crops during pollinator hours, and never spray a tank mix of unapproved products.',
      mr: 'तुमची स्वतःची पाहणी स्थानिक पातळीवर मान्य असलेल्या कृती-मर्यादेपेक्षा जास्त असेल तरच कीटकनाशक न्याय्य आहे — कॅलेंडरनुसार नाही. प्रतिकारशक्ती टाळण्यासाठी घटक बदलून वापरा.',
    },
    monitoring: {
      en: 'Keep traps running weekly and record the count per trap per week. Scout ten plants at five points across the plot each visit, checking the growing point and the underside of leaves, and record the numbers so a trend is available for the officer.',
      mr: 'सापळे साप्ताहिक सुरू ठेवा व प्रति सापळा प्रति आठवडा नोंद करा. प्रत्येक भेटीत प्लॉटमधील पाच ठिकाणी दहा रोपे तपासा व संख्या नोंदवा.',
    },
    referral: {
      en: 'Refer to the KVK or agriculture officer if the pest cannot be identified confidently, if damage continues after two correctly-timed interventions, or if unusual or quarantine pests are suspected. Bring the trap catch and photographs with you.',
      mr: 'कीटक निश्चित ओळखता न आल्यास, दोन योग्य वेळी केलेल्या उपायांनंतरही नुकसान सुरू असल्यास किंवा असामान्य कीटकाचा संशय असल्यास KVK किंवा कृषी अधिकाऱ्यांकडे वळा. सापळ्यातील नमुना व छायाचित्रे सोबत न्या.',
    },
  },
  disorder: {
    immediate: {
      en: 'First rule out a pest or disease: shake the plant over white paper and inspect the growing point. Then check drainage, recent irrigation, fertiliser history and soil pH, and plan a soil test instead of guessing.',
      mr: 'आधी कीड किंवा रोग नाही याची खात्री करा: रोपावर पांढऱ्या कागदावर हलके हलवा व शेंडा तपासा. नंतर निचरा, सिंचन, खत इतिहास व मातीचा सामू पाहा.',
    },
    prevention: {
      en: 'Get a soil test before planting and build organic matter with farmyard manure or compost. Correct pH gradually over seasons rather than in one heavy application, and avoid salt build-up from over-fertilising in drip systems.',
      mr: 'लागवडीपूर्वी माती परीक्षण करा आणि शेणखत/कंपोस्टने सेंद्रिय घटक वाढवा. सामू हळूहळू सुधारा व ठिबकमध्ये जास्त खत देऊन क्षारता टाळा.',
    },
    cultural: {
      en: 'Fix drainage and standing water, avoid root damage during inter-cultivation, mulch to stabilise moisture, and use a foliar feed only where a deficiency has been confirmed and a local recommendation exists.',
      mr: 'निचरा सुधारा, कोळपणीत मुळांचे नुकसान टाळा, आच्छादन वापरा आणि कमतरता पुष्टी झाल्यासच पानावरील अन्नद्रव्य द्या.',
    },
    biological: {
      en: 'Compost, vermicompost and biofertilisers such as Rhizobium, Azotobacter or phosphate-solubilising bacteria improve nutrient availability slowly and safely where they suit the crop.',
      mr: 'कंपोस्ट, गांडूळ खत व रायझोबियम, अॅझोटोबॅक्टर किंवा फॉस्फेट विरघळवणारे जिवाणू यांसारखी जैविक खते पोषण उपलब्धता सुधारतात.',
    },
    chemical: {
      en: 'Correct a confirmed deficiency only through a soil-test-based fertiliser plan. Do not apply unplanned micronutrient cocktails — over-correction causes its own toxicity problems and wastes money.',
      mr: 'पुष्टी झालेली कमतरता माती परीक्षण आधारित खत नियोजनानेच दुरुस्त करा. अविचारी सूक्ष्म अन्नद्रव्य मिश्रणे देऊ नका.',
    },
    monitoring: {
      en: 'Re-examine leaves and re-check the soil after 10–14 days, and photograph the same plant each time so the response is visible. A deficiency that keeps spreading usually means the diagnosis or the application method was wrong.',
      mr: '10–14 दिवसांनी पाने व माती पुन्हा तपासा आणि त्याच रोपाचे पुन्हा छायाचित्र घ्या.',
    },
    referral: {
      en: 'Ask the KVK or a soil-testing laboratory for a soil and plant-tissue analysis. It is far cheaper than repeated sprays that cannot fix a nutritional problem.',
      mr: 'KVK किंवा माती परीक्षण प्रयोगशाळेकडून माती व वनस्पती ऊती विश्लेषण करून घ्या.',
    },
  },
  healthy: {
    immediate: {
      en: 'No action is required on the plant. Keep the screening record — a documented healthy baseline is what makes the next change detectable.',
      mr: 'रोपावर कोणतीही कृती आवश्यक नाही. ही तपासणी नोंद ठेवा — पुढील बदल ओळखण्यासाठी आधार ठरेल.',
    },
    prevention: {
      en: 'Maintain what is working: rotation, clean planting material, balanced nutrition, sanitation after harvest and timely sowing for your district.',
      mr: 'यशस्वी असलेल्या गोष्टी चालू ठेवा: पीक फेरपालट, स्वच्छ रोपे, संतुलित पोषण, काढणीनंतर स्वच्छता व योग्य वेळी पेरणी.',
    },
    cultural: {
      en: 'Keep the plot weed-free, manage water so the root zone is never waterlogged, and remove crop residue that could shelter next season’s pests.',
      mr: 'प्लॉट तणमुक्त ठेवा, मुळांभोवती पाणी साचू देऊ नका आणि पीक अवशेष काढा.',
    },
    biological: {
      en: 'Keep supporting soil biology with compost and biofertilisers, and avoid unnecessary sprays that would remove the natural enemies already present.',
      mr: 'कंपोस्ट व जैविक खतांनी मातीचे जैविक जीवन टिकवा आणि अनावश्यक फवारण्या टाळून नैसर्गिक शत्रू जपा.',
    },
    chemical: {
      en: 'No chemical application is recommended on a healthy crop. Preventive calendar spraying wastes money, harms natural enemies and builds resistance.',
      mr: 'निरोगी पिकावर रासायनिक फवारणीची शिफारस नाही. प्रतिबंधात्मक कॅलेंडर फवारणी पैसे वाया घालवते व प्रतिकारशक्ती वाढवते.',
    },
    monitoring: {
      en: 'Continue routine scouting once a week and after every heavy rain or strong wind event, when damage often becomes visible.',
      mr: 'आठवड्यातून एकदा आणि मुसळधार पाऊस किंवा जोरदार वाऱ्यानंतर नियमित पाहणी सुरू ठेवा.',
    },
    referral: {
      en: 'No referral is needed. If you later notice a change you cannot explain, bring the plant to the nearest KVK or agriculture office.',
      mr: 'संदर्भ आवश्यक नाही. नंतर समजू न शकणारा बदल दिसल्यास रोप जवळच्या KVK किंवा कृषी कार्यालयात न्या.',
    },
  },
  unknown: {
    immediate: {
      en: 'Isolate the affected plants in your records and take a closer, well-lit photograph of both leaf surfaces and the stem. Do not apply any treatment until the problem is identified.',
      mr: 'बाधित रोपे नोंदीत वेगळी ठेवा आणि पानाच्या दोन्ही बाजूंचे स्पष्ट छायाचित्र घ्या. कारण निश्चित होईपर्यंत कोणताही उपाय करू नका.',
    },
    prevention: {
      en: 'Continue the good practices you already follow — sanitation, clean seed, balanced nutrition — while the problem is being identified.',
      mr: 'कारण निश्चित होईपर्यंत सध्याच्या चांगल्या पद्धती सुरू ठेवा.',
    },
    cultural: {
      en: 'Remove only clearly dead tissue and keep the plot tidy, so a later inspection is not confused by old damage.',
      mr: 'पूर्ण मृत भागच काढा आणि प्लॉट स्वच्छ ठेवा, म्हणजे पुढील पाहणी स्पष्ट होईल.',
    },
    biological: {
      en: 'No specific bio-agent can be suggested without an identified cause. Do not apply random bio-inputs.',
      mr: 'कारण माहीत नसल्यास विशिष्ट जैविक उत्पादन सुचवता येत नाही.',
    },
    chemical: {
      en: 'Do not spray a broad-spectrum pesticide as a guess. It costs money, kills natural enemies and masks the symptoms that an expert needs to see.',
      mr: 'अंदाजाने व्यापक-कृती कीटकनाशक फवारू नका; ते पैसे वाया घालवते व नैसर्गिक शत्रू मारते.',
    },
    monitoring: {
      en: 'Re-inspect within 48 hours, or immediately after any rain, and compare against the photographs you took.',
      mr: '48 तासांत किंवा पावसानंतर लगेच पुन्हा पाहणी करा.',
    },
    referral: {
      en: 'This is exactly the case to submit for expert review. Attach the image, symptoms, location and notes so the reviewer has everything needed.',
      mr: 'हेच प्रकरण तज्ज्ञ पडताळणीस पाठवावे. प्रतिमा, लक्षणे, ठिकाण व टिपा जोडा.',
    },
  },
};

const RAW_CONDITIONAL: AdvisorySectionKey[] = ['immediate', 'cultural'];

/** Condition-specific opening instruction shown before the category template. */
const CONDITION_IMMEDIATE: Record<string, L> = {
  cotton_pink_bollworm: {
    en: 'Inspect green bolls and flowers: look for rosette flowers, entry holes and pinkish larvae inside the boll. Collect and destroy all infested bolls and dropped fruiting bodies daily.',
    mr: 'हिरवी बोंडे व फुले तपासा: गुच्छ फुले, छिद्रे व आत गुलाबी अळ्या शोधा. बाधित बोंडे व गळलेली फळे दररोज गोळा करून नष्ट करा.',
  },
  soybean_yvm: {
    en: 'Look for mosaic mottling and puckered leaves, and count whiteflies on the underside of leaves. Remove infected plants early — the virus cannot be cured once inside the plant.',
    mr: 'मोझॅक ठिपके व चुरडलेली पाने पाहा आणि पानाच्या खालच्या बाजूला पांढऱ्या माश्या मोजा. बाधित रोपे लवकर काढा.',
  },
  cotton_fusarium_wilt: {
    en: 'Check for one-sided wilting and cut a stem low down: brown streaks inside the vascular ring indicate Fusarium wilt. Improve drainage and do not save seed from affected plants.',
    mr: 'एका बाजूला वाळण्याचे लक्षण पाहा व खालून खोड छाटून पहा. वाहक वलयात तपकिरी रेषा दिसल्यास वाळवंट निर्मूल रोग आहे. पाण्याचा निचरा सुधारा.',
  },
  soybean_downy_mildew: {
    en: 'Turn leaves over: a white downy growth on the underside with pale yellow patches on top points to downy mildew. Open the canopy and avoid evening irrigation so leaves dry before night.',
    mr: 'पाने उलटा: खालच्या बाजूला पांढरी भुसभुशीत वाढ व वर पिवळसर पाचवे ठिपके हे डाऊनी मिल्ड्यूचे लक्षण. संध्याकाळचे सिंचन टाळा.',
  },
  soybean_rust: {
    en: 'Look for tiny raised reddish-brown pustules on the lower leaf surface that rub off as powder. Scout the lower canopy first — rust starts there and moves up.',
    mr: 'खालच्या पानांवर लाल-तपकिरी उंचवटलेले तुरटीप्रमाणे पुंडके शोधा. खालच्या भागातून पाहणी सुरू करा.',
  },
};

/** Verification status template per section (advisory.verified / advisory.needsVerification keys). */
const SOURCE_KEYS: Record<AdvisorySectionKey, string> = {
  immediate: 'advisory.verified',
  prevention: 'advisory.verified',
  cultural: 'advisory.verified',
  biological: 'advisory.needsVerification',
  chemical: 'advisory.needsVerification',
  monitoring: 'advisory.verified',
  referral: 'advisory.verified',
};

export function categoryFor(conditionId: string, category: ConditionCategory): ConditionCategory {
  if (conditionId === 'healthy') return 'healthy';
  return category;
}

export function buildAdvisory(args: {
  conditionId: string;
  category: ConditionCategory;
  conditionLabel: string;
  lang: Lang;
}): Advisory {
  const { conditionId, conditionLabel, lang } = args;
  const category = categoryFor(conditionId, args.category);
  const template = TEMPLATES[category] ?? TEMPLATES.unknown;

  const sections: AdvisorySection[] = ADVISORY_SECTION_ORDER.map((key) => {
    let body: string;
    if (key === 'immediate' && CONDITION_IMMEDIATE[conditionId]) {
      body = `${CONDITION_IMMEDIATE[conditionId][lang]}\n\n${template.immediate[lang]}`;
    } else {
      body = template[key][lang];
    }
    return {
      key,
      titleKey: TITLES[key],
      body,
      verification: RAW_CONDITIONAL.includes(key) ? 'general-ipm' : (SOURCE_KEYS[key] as Verification),
      sourceKey: SOURCE_KEYS[key],
    };
  });

  return {
    conditionId,
    conditionLabel,
    sections,
    safetyKeys: ['safety.ppe', 'safety.label', 'safety.preharvest', 'safety.noDosage', 'safety.expert'],
    generatedAt: new Date().toISOString(),
    locale: lang,
  };
}

export interface OrganEducationItem {
  id: string;
  name: string;
  latinName: string;
  category: string;
  color: number; // Three.js hex
  hexColor: string;
  position3D: [number, number, number]; // Position in holographic human space
  iconName: string;
  summary: string;
  workingMechanism: {
    step: number;
    title: string;
    description: string;
  }[];
  nutrientInteractions: {
    nutrient: string;
    role: string;
    mechanism: string;
  }[];
  relatedAstFormulas: {
    id: string;
    name: string;
    equation: string;
    tab: 'calculator' | 'registry' | 'experiments' | 'statistics';
  }[];
  textbookCitation: {
    source: string;
    chapter: string;
    pages: string;
    summary: string;
  };
  clinicalImpact: {
    condition: string;
    nutritionRelevance: string;
  }[];
  quickCheck: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  };
}

export const ORGAN_EDUCATION_DATA: OrganEducationItem[] = [
  {
    id: 'heart',
    name: 'Jantung & Sirkulasi Vaskular',
    latinName: 'Cor & Systema Cardiovasculare',
    category: 'Kardiovaskular & Hemodinamika',
    color: 0xef4444,
    hexColor: '#ef4444',
    position3D: [-0.35, 4.3, -2.0],
    iconName: 'Heart',
    summary: 'Pompa muskular ganda yang mempertahankan gradien tekanan arteri dan mendistribusikan oksigen serta makronutrien ke seluruh kapiler jaringan perifer.',
    workingMechanism: [
      {
        step: 1,
        title: 'Pengisian Diastolik & Preload',
        description: 'Darah terdeoksigenasi dari vena kava masuk ke atrium kanan, sementara darah teroksigenasi dari vena pulmonalis mengisi atrium kiri. Relaksasi ventrikel memungkinkan pengisian darah pasif (80%) diikuti kontraksi atrium (20%).'
      },
      {
        step: 2,
        title: 'Konduksi Nodus SA & Eksitasi Elektrik',
        description: 'Potensial aksi dipicu otomatis oleh nodus sinoatrial (SA), merambat melalui berkas His dan serat Purkinje, menghasilkan depolarisasi miosit ventrikel yang tersinkronisasi.'
      },
      {
        step: 3,
        title: 'Ejeksi Sistolik & Curah Jantung',
        description: 'Ventrikel berkontraksi isovolumetrik hingga tekanan melampaui katup aorta dan pulmonal. Ejeksi darah menghasilkan volume sekuncup (Stroke Volume) sekitar 70 mL per denyut pada kondisi basal.'
      },
      {
        step: 4,
        title: 'Resistensi Vaskular & Perfusi Jaringan',
        description: 'Arteriol bertindak sebagai katup resistensi utama. Tekanan darah arteri rata-rata (MAP) menjaga gradien perfusi agar mikrosirkulasi nutrisi dan pertukaran gas di dasar kapiler tetap optimal.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Natrium & Kalium (Na⁺ / K⁺)',
        role: 'Regulasi Potensial Aksi & Tekanan Darah',
        mechanism: 'Rasio Na/K mengontrol volume cairan ekstraseluler dan elastisitas endotel arteri via pompa Na⁺/K⁺-ATPase membran miosit.'
      },
      {
        nutrient: 'Magnesium & Kalsium (Mg²⁺ / Ca²⁺)',
        role: 'Kopling Eksitasi-Kontraksi Otot Jantung',
        mechanism: 'Influks Ca²⁺ memicu interaksi aktin-miosin; Mg²⁺ bertindak sebagai antagonis alami kalsium untuk mencegah aritmia dan spasme pembuluh darah.'
      },
      {
        nutrient: 'Asam Lemak Bebas (FFA)',
        role: 'Bahan Bakar Utama Energi Miokardium',
        mechanism: '60–70% ATP jantung dihasilkan dari beta-oksidasi asam lemak di mitokondria miosit untuk kontraksi terus-menerus tanpa henti.'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'map_formula',
        name: 'Tekanan Arteri Rata-rata (MAP)',
        equation: 'MAP = DBP + 1/3(SBP - DBP)',
        tab: 'registry'
      },
      {
        id: 'cardiac_output',
        name: 'Curah Jantung (Cardiac Output)',
        equation: 'CO = HR × SV',
        tab: 'calculator'
      }
    ],
    textbookCitation: {
      source: 'Guyton and Hall Textbook of Medical Physiology (14th Ed.)',
      chapter: 'Bab 9: Otot Jantung; Jantung Sebagai Pompa',
      pages: 'hlm. 109–122',
      summary: 'Menjelaskan mekanisme kontraksi ventrikel, hukum Frank-Starling, dan regulasi hemodinamik sistemik.'
    },
    clinicalImpact: [
      {
        condition: 'Hipertensi Esensial',
        nutritionRelevance: 'Restriksi natrium (<2000 mg/hari) dan diet DASH kaya kalium terbukti menurunkan kekakuan resistensi vaskular sistemik.'
      },
      {
        condition: 'Gagal Jantung Kongestif',
        nutritionRelevance: 'Retensi cairan membutuhkan pemantauan ketat asupan garam, asupan cairan, dan suplementasi tiamin untuk metabolisme piruvat miokardium.'
      }
    ],
    quickCheck: {
      question: 'Apa substrat energi utama yang dikonsumsi oleh otot jantung miosit pada kondisi fisiologis normal?',
      options: [
        'Glukosa murni secara anaerob',
        'Asam lemak bebas (beta-oksidasi mitokondria 60-70%)',
        'Benda keton sebagai satu-satunya bahan bakar',
        'Asam amino rantai cabang (BCAA) murni'
      ],
      correctIndex: 1,
      explanation: 'Miokardium menggunakan asam lemak bebas (FFA) sebagai sumber energi utama (60–70% ATP) melalui beta-oksidasi mitokondria, dan dapat beralih ke laktat/glukosa saat beban kerja meningkat.'
    }
  },
  {
    id: 'lungs',
    name: 'Paru-Paru & Sistem Respirasi',
    latinName: 'Pulmones & Systema Respiratorium',
    category: 'Pertukaran Gas & Keseimbangan Asam-Basa',
    color: 0x06b6d4,
    hexColor: '#06b6d4',
    position3D: [0.0, 4.4, -2.1],
    iconName: 'Wind',
    summary: 'Organ pertukaran gas hemat-energi yang mengatur saturasi O₂ hemoglobin dan menjadi kompensator cepat perubahan pH darah melalui eliminasi CO₂.',
    workingMechanism: [
      {
        step: 1,
        title: 'Ventilasi Pulmonal & Tekanan Negatif',
        description: 'Kontraksi diafragma dan otot interkostal eksterna memperbesar rongga toraks, menciptakan tekanan intrapleural negatif (-5 hingga -7.5 cmH₂O) yang menarik udara atmosfer masuk.'
      },
      {
        step: 2,
        title: 'Difusi Gas Alveolar-Kapiler',
        description: 'Oksigen berdifusi menembus membran respirasi tipis (0.5 mikron) dari alveolus ke kapiler darah, sementara CO₂ berdifusi ke arah berlawanan sesuai gradien tekanan parsial Fick.'
      },
      {
        step: 3,
        title: 'Buffer Bikarbonat & Regulasi Asam-Basa',
        description: 'Enzim karbonik anhidrase dalam eritrosit mengonversi ion bikarbonat (HCO₃⁻) dan H⁺ menjadi H₂O dan CO₂ gas untuk diekshalasi dalam hitungan detik saat asidosis terjadi.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Karbohidrat vs Lemak (RQ Effect)',
        role: 'Beban Produksi Karbon Dioksida (VCO₂)',
        mechanism: 'Oksidasi karbohidrat menghasilkan Rasio Respirasi (RQ) = 1.0 (lebih banyak CO₂), sedangkan lemak RQ = 0.7. Pada pasien gagal napas, diet tinggi lemak/rendah karbohidrat mengurangi beban kerja pernapasan.'
      },
      {
        nutrient: 'Zat Besi (Fe²⁺)',
        role: 'Pengikatan O₂ pada Hemoglobin',
        mechanism: 'Empat atom besi dalam molekul hemoglobin memungkinkan pengikatan reversibel 4 molekul O₂ untuk dihantarkan ke mitokondria seluler.'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'rq_formula',
        name: 'Koefisien Kuosien Respirasi (RQ)',
        equation: 'RQ = VCO₂ / VO₂',
        tab: 'calculator'
      },
      {
        id: 'weir_equation',
        name: 'Persamaan Weir (Kalorimetri Tidak Langsung)',
        equation: 'EE = 3.941×VO₂ + 1.106×VCO₂ - 2.17×uN',
        tab: 'calculator'
      }
    ],
    textbookCitation: {
      source: 'Guyton and Hall Textbook of Medical Physiology (14th Ed.)',
      chapter: 'Bab 39: Ventilasi Paru & Pertukaran Gas Alveolus',
      pages: 'hlm. 497–514',
      summary: 'Menguraikan dinamika difusi membran, ventilasi-perfusi (V/Q), dan eliminasi CO₂ metabolik.'
    },
    clinicalImpact: [
      {
        condition: 'PPOK (Penyakit Paru Obstruktif Kronis)',
        nutritionRelevance: 'Penurunan konsumsi karbohidrat sederhana mengurangi hiperkapnia (retensi CO₂) dan kelelahan otot diafragma.'
      }
    ],
    quickCheck: {
      question: 'Mengapa formula nutrisi untuk pasien gagal napas sering dirancang dengan proporsi lemak lebih tinggi dan karbohidrat lebih rendah?',
      options: [
        'Karena lemak tidak menghasilkan kalori',
        'Karena respirasi lemak memiliki nilai RQ lebih rendah (0.7), sehingga memproduksi lebih sedikit CO₂ per liter O₂ yang dikonsumsi',
        'Karena karbohidrat tidak dapat dicerna di lambung',
        'Agar pasien cepat tertidur'
      ],
      correctIndex: 1,
      explanation: 'Oksidasi lipid memiliki RQ 0.70 dibandingkan karbohidrat 1.00. Nilai RQ yang lebih rendah berarti produksi gas CO₂ lebih minimal untuk jumlah energi yang sama, meringankan beban ventilasi paru.'
    }
  },
  {
    id: 'stomach',
    name: 'Lambung & Saluran Cerna',
    latinName: 'Gaster & Tractus Gastrointestinalis',
    category: 'Digesti, Absorpsi & Mikrobioma',
    color: 0xf59e0b,
    hexColor: '#f59e0b',
    position3D: [-0.5, 3.6, -2.0],
    iconName: 'Utensils',
    summary: 'Pintu gerbang bio-transformasi makronutrien: asam hidroklorida (HCl), denaturasi protein, emulsifikasi empedu, dan penyerapan mikrovili usus halus.',
    workingMechanism: [
      {
        step: 1,
        title: 'Sekresi Asam Lambung & Enzimatis',
        description: 'Sel parietal mensekresi HCl (pH 1.5–2.0) yang membunuh mikroba patogen dan mengaktivasi pepsinogen menjadi pepsin untuk memotong rantai polipeptida protein.'
      },
      {
        step: 2,
        title: 'Motilitas Antral & Kimus Cair',
        description: 'Gelombang peristaltik lambung (3 siklus per menit) mencampur bolus makanan menjadi kimus semi-cair sebelum dilepaskan secara bertahap melalui sfingter pilorus ke duodenum.'
      },
      {
        step: 3,
        title: 'Absorpsi Mikrovili Usus Halus',
        description: 'Enzim brush-border (laktase, sukrase, peptidase) bersama sekresi lipase pankreas menyelesaikan hidrolisis nutrien, diserap melalui transport aktif SGLT-1 dan difusi terfasilitasi.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Serat Larut & Tidak Larut',
        role: 'Modulasi Pengosongan Lambung & Fermentasi Usus',
        mechanism: 'Serat larut (pektin, beta-glukan) membentuk gel yang memperlambat penyerapan glukosa; difermentasi mikrobiota kolon menjadi asam lemak rantai pendek (SCFA: asetat, propionat, butirat).'
      },
      {
        nutrient: 'Vitamin B12 & Faktor Intrinsik',
        role: 'Absorpsi Hematopoietik di Ileum Terminal',
        mechanism: 'Glikoprotein faktor intrinsik disintesis oleh sel parietal lambung dan berikatan spesifik dengan kobalamin agar dapat diserap di ileum.'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'glycemic_load',
        name: 'Beban Glikemik Makanan (Glycemic Load)',
        equation: 'GL = (GI × CHO_gram) / 100',
        tab: 'calculator'
      },
      {
        id: 'protein_digestibility',
        name: 'Skor PDCAAS Protein',
        equation: 'PDCAAS = True_Digestibility × Amino_Acid_Score',
        tab: 'registry'
      }
    ],
    textbookCitation: {
      source: 'Krause and Mahan Food and the Nutrition Care Process (15th Ed.)',
      chapter: 'Bab 1: Asuhan Nutrisi & Pencernaan Gastrointestinal',
      pages: 'hlm. 1–28',
      summary: 'Membahas dinamika pencernaan, enzim luminal, dan peranan barier mukosa usus.'
    },
    clinicalImpact: [
      {
        condition: 'Sindrom Malabsorpsi',
        nutritionRelevance: 'Atrofi vili usus (misalnya penyakit celiac) menurunkan luas permukaan absorpsi kalsium, zat besi, dan vitamin larut lemak (A, D, E, K).'
      }
    ],
    quickCheck: {
      question: 'Senyawa penting apa yang disekresi oleh sel parietal lambung yang esensial untuk penyerapan vitamin B12 di ileum?',
      options: [
        'Enzim Amilase Saliva',
        'Faktor Intrinsik (Intrinsic Factor)',
        'Asam Empedu Deoksikolat',
        'Hormon Kolesistokinin (CCK)'
      ],
      correctIndex: 1,
      explanation: 'Sel parietal lambung memproduksi Faktor Intrinsik (Intrinsic Factor), yang berikatan dengan vitamin B12 (kobalamin) sehingga tahan terhadap enzim proteolitik dan dapat diserap secara selektif di ileum terminal.'
    }
  },
  {
    id: 'liver',
    name: 'Hati (Hepar) & Pusat Biokimia',
    latinName: 'Hepar & Metabolismum Centrale',
    category: 'Biokimia Intermediat & Detoksifikasi',
    color: 0x10b981,
    hexColor: '#10b981',
    position3D: [0.6, 3.7, -2.0],
    iconName: 'Activity',
    summary: 'Laboratorium metabolik sentral tubuh yang mengontrol homeostasis glukosa darah, sintesis albumin, metabolisme lipid lipoprotein, dan siklus pembuangan amonia urea.',
    workingMechanism: [
      {
        step: 1,
        title: 'Buffer Glukosa Darah (Glukostat)',
        description: 'Saat kadar glukosa portal tinggi pasca-makan, insulin memicu glikogenesis (penyimpanan glikogen hati hingga 100g). Saat puasa, glukagon mengaktivasi glikogenolisis dan glukoneogenesis dari laktat dan gliserol.'
      },
      {
        step: 2,
        title: 'Siklus Urea & Klirens Amonia',
        description: 'Katabolisme asam amino menghasilkan amonia (NH₃) yang sangat neurotoksik. Hepatosit mengonversi amonia menjadi urea nontoksik melalui 5 reaksi siklus urea untuk diekskresi via urin.'
      },
      {
        step: 3,
        title: 'Sintesis Protein Plasma & Empedu',
        description: 'Memproduksi 100% albumin plasma (mempertahankan tekanan onkotik koloid), faktor pembekuan darah, serta asam empedu untuk emulsifikasi lemak diet.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Asam Amino Rantai Cabang (BCAA: Leu, Ile, Val)',
        role: 'Regulasi Keseimbangan Protein & Klirens Otot',
        mechanism: 'BCAA tidak dimetabolisme oleh hati melainkan langsung di otot skeletal, menjadikannya kunci terapi nutrisi pada ensefalopati hepatik.'
      },
      {
        nutrient: 'Kolin & Metionin',
        role: 'Sintesis Fosfatidilkolin & Pencegahan Steatosis',
        mechanism: 'Diperlukan untuk perakitan partikel VLDL; defisiensi kolin menghambat ekspor trigliserida dari hepatosit, memicu perlemakan hati (NAFLD).'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'nitrogen_balance',
        name: 'Keseimbangan Nitrogen Tubuh',
        equation: 'NB = (Protein_In / 6.25) - (UUN + 4)',
        tab: 'calculator'
      },
      {
        id: 'bmr_mifflin',
        name: 'Pengeluaran Energi Basal (Mifflin-St Jeor)',
        equation: 'BMR = 10×W + 6.25×H - 5×A + S',
        tab: 'calculator'
      }
    ],
    textbookCitation: {
      source: 'Guyton and Hall Textbook of Medical Physiology (14th Ed.)',
      chapter: 'Bab 71: Metabolisme Lemak & Fungsi Hati',
      pages: 'hlm. 871–884',
      summary: 'Menguraikan metabolisme lipoprotein, degradasi bilirubin, dan kontrol enzimatik hepar.'
    },
    clinicalImpact: [
      {
        condition: 'Sirosis Hati & Ensefalopati',
        nutritionRelevance: 'Penumpukan amonia plasma memerlukan optimasi rasio Fischer (BCAA / Aromatic Amino Acids) dan asupan energi non-protein yang adekuat.'
      }
    ],
    quickCheck: {
      question: 'Melalui siklus biokimia apa hati menetralkan amonia toksik hasil pemecahan asam amino menjadi senyawa yang aman untuk diekskresi ginjal?',
      options: [
        'Siklus Krebs / Asam Sitrat',
        'Siklus Urea (Ornitin-Sitrulin)',
        'Siklus Cori (Laktat-Glukosa)',
        'Jalur Pentosa Fosfat'
      ],
      correctIndex: 1,
      explanation: 'Siklus Urea (juga dikenal sebagai siklus ornitin) di hepatosit hati menggabungkan dua gugus amonia dengan karbon dioksida menjadi urea, senyawa larut air yang tidak toksik dan aman dibuang oleh ginjal.'
    }
  },
  {
    id: 'kidneys',
    name: 'Ginjal & Keseimbangan Cairan',
    latinName: 'Renes & Homeostasis Osmotica',
    category: 'Filtrasi, Osmoregulasi & Elektrolit',
    color: 0x3b82f6,
    hexColor: '#3b82f6',
    position3D: [0.0, 3.1, -2.3],
    iconName: 'Droplets',
    summary: 'Organ regulator ultrafiltrasi darah (180 L/hari filtrat), reabsorpsi selektif glukosa dan elektrolit, pengatur osmolalitas ekstraseluler, dan kontrol hormonal eritropoietin.',
    workingMechanism: [
      {
        step: 1,
        title: 'Ultrafiltrasi Glomerulus (GFR)',
        description: 'Darah bertekanan tinggi dari arteriol aferen disaring melalui membran endotel glomerulus, menghasilkan sekitar 125 mL filtrat bebas protein per menit (Laju Filtrasi Glomerulus / GFR).'
      },
      {
        step: 2,
        title: 'Reabsorpsi Tubulus & Pertukaran Ion',
        description: 'Tubulus proksimal mereabsorpsi 100% glukosa dan asam amino serta 65% air dan ion Na⁺/Cl⁻. Lengkung Henle menciptakan gradien osmotik medula ginjal hipertonik.'
      },
      {
        step: 3,
        title: 'Konsentrasi Urin via Hormon ADH & Aldosteron',
        description: 'Duktus koligens merespons hormon antidiuretik (ADH) dengan memasukkan kanal aquaporin-2, mereabsorpsi air murni untuk mencegah dehidrasi hiperosmotik.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Fosfat & Kalsium',
        role: 'Regulasi Vitamin D Aktif (Kalsitriol)',
        mechanism: 'Enzim 1-alfa-hidroksilase di tubulus ginjal mengaktivasi 25-(OH)D menjadi 1,25-(OH)₂D (kalsitriol), kunci utama penyerapan kalsium di usus.'
      },
      {
        nutrient: 'Beban Solut Ginjal (Renal Solute Load)',
        role: 'Kebutuhan Cairan Pelarut Urin',
        mechanism: 'Ekskresi produk akhir metabolisme protein (urea) dan elektrolit membutuhkan volume air minimal agar tidak melampaui kapasitas konsentrasi urin maksimal (1200 mOsm/kg).'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'gfr_cockcroft',
        name: 'Laju Filtrasi Glomerulus (Cockcroft-Gault)',
        equation: 'eGFR = ((140 - Umur) × BB) / (72 × SCr) [× 0.85 jika wanita]',
        tab: 'calculator'
      },
      {
        id: 'plasma_osmolality',
        name: 'Osmolalitas Plasma Efektif',
        equation: 'Osm = 2×Na + Glukosa/18 + BUN/2.8',
        tab: 'registry'
      }
    ],
    textbookCitation: {
      source: 'Guyton and Hall Textbook of Medical Physiology (14th Ed.)',
      chapter: 'Bab 26: Pembentukan Urin oleh Ginjal; Filtrasi Glomerulus',
      pages: 'hlm. 323–342',
      summary: 'Menerangkan koefisien ultrafiltrasi Kf, autoregulasi miogenik arteriol, dan mekanisme konsentrasi arus balik.'
    },
    clinicalImpact: [
      {
        condition: 'Penyakit Ginjal Kronik (PGK)',
        nutritionRelevance: 'Penurunan GFR memerlukan pembatasan asupan fosfor, kalium, dan penyesuaian protein presisi (0.6–0.8 g/kgBB) guna memperlambat progresi uremia.'
      }
    ],
    quickCheck: {
      question: 'Berapa perkiraan volume filtrat glomerulus yang disaring oleh kedua ginjal manusia dewasa setiap harinya sebelum direabsorpsi kembali?',
      options: [
        'Sekitar 1.5–2 Liter per hari',
        'Sekitar 10–15 Liter per hari',
        'Sekitar 180 Liter per hari (hampir 99% diserap kembali)',
        'Sekitar 1000 Liter per hari'
      ],
      correctIndex: 2,
      explanation: 'Kedua ginjal menyaring sekitar 180 Liter filtrat per hari melalui glomerulus, namun tubulus ginjal mereabsorpsi kembali lebih dari 99% air dan solut, sehingga volume urin akhir yang dikeluarkan hanya sekitar 1.5–2 Liter per hari.'
    }
  },
  {
    id: 'brain',
    name: 'Otak & Sinyal Neuroendokrin',
    latinName: 'Cerebrum & Hypothalamus',
    category: 'Regulasi Nafsu Makan & Homeostasis Pusat',
    color: 0x8b5cf6,
    hexColor: '#8b5cf6',
    position3D: [0.0, 5.5, -2.2],
    iconName: 'Sparkles',
    summary: 'Pusat komando pengendali metabolisme seluruh tubuh: nukleus arkuata hipotalamus yang mengintegrasikan sinyal perifer ghrelin (lapar) dan leptin (kenyang), serta ritme sirkadian metabolisme.',
    workingMechanism: [
      {
        step: 1,
        title: 'Penginderaan Sinyal Perifer (Gut-Brain Axis)',
        description: 'Hormon ghrelin dari lambung kosong mengaktivasi neuron oreksigenik NPY/AgRP untuk merangsang rasa lapar. Sebaliknya, distensi usus dan hormon PYY/GLP-1 menghambat sinyal lapar.'
      },
      {
        step: 2,
        title: 'Sinyal Cadangan Lemak via Leptin',
        description: 'Adiposit melepaskan leptin sebanding dengan massa lemak tubuh. Leptin mengaktivasi neuron anoreksigenik POMC/CART di hipotalamus untuk menekan nafsu makan dan meningkatkan pengeluaran energi.'
      },
      {
        step: 3,
        title: 'Aktivasi Sistem Saraf Otonom',
        description: 'Melalui saraf simpatis, otak mengatur termogenesis jaringan lemak coklat (BAT), detak jantung basal, dan pelepasan glukosa hepar saat respons fight-or-flight.'
      }
    ],
    nutrientInteractions: [
      {
        nutrient: 'Glukosa & Benda Keton (Beta-hidroksibutirat)',
        role: 'Bahan Bakar Spesifik Jaringan Otak',
        mechanism: 'Otak mengonsumsi 20% glukosa tubuh saat istirahat; pada kondisi puasa berkepanjangan (>48 jam), otak mengadaptasi transporter MCT untuk membakar benda keton.'
      },
      {
        nutrient: 'Triptofan & Tirosin (Prekursor Neurotransmiter)',
        role: 'Sintesis Serotonin & Dopamin',
        mechanism: 'Asam amino esensial triptofan menembus sawar darah-otak untuk disintesis menjadi serotonin (regulator mood dan rasa kenyang).'
      }
    ],
    relatedAstFormulas: [
      {
        id: 'harris_benedict',
        name: 'Persamaan Harris-Benedict (Pengeluaran Energi)',
        equation: 'BEE = 66.5 + (13.75 × W) + (5.003 × H) - (6.75 × A)',
        tab: 'calculator'
      },
      {
        id: 'bmi_who',
        name: 'Indeks Massa Tubuh (BMI / IMT)',
        equation: 'BMI = BB / (TB_meter)²',
        tab: 'calculator'
      }
    ],
    textbookCitation: {
      source: 'Guyton and Hall Textbook of Medical Physiology (14th Ed.)',
      chapter: 'Bab 72: Pengaturan Keseimbangan Energi & Makanan; Obesitas vs Kelaparan',
      pages: 'hlm. 885–898',
      summary: 'Mengulas sirkuit saraf hipotalamus, aksi leptin vs ghrelin, dan kontrol metabolik pusat.'
    },
    clinicalImpact: [
      {
        condition: 'Resistensi Leptin pada Obesitas',
        nutritionRelevance: 'Kelebihan jaringan adiposa kronis menyebabkan hiperleptinemia yang menumpulkan sensitivitas reseptor hipotalamus, memicu rasa lapar terus-menerus.'
      }
    ],
    quickCheck: {
      question: 'Hormon perifer apa yang terutama disekresi oleh sel lambung saat kosong untuk memberi sinyal lapar ke hipotalamus otak?',
      options: [
        'Leptin dari jaringan adiposa',
        'Ghrelin dari mukosa lambung',
        'Insulin dari sel beta pankreas',
        'Kolekistokinin (CCK) dari duodenum'
      ],
      correctIndex: 1,
      explanation: 'Ghrelin adalah hormon peptida yang disekresi terutama oleh sel P/D1 lambung saat lambung kosong. Hormon ini mengaktivasi neuron NPY/AgRP di nukleus arkuata hipotalamus untuk merangsang rasa lapar.'
    }
  }
];

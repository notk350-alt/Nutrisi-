import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { TabId } from '../layout/Sidebar';
import { ORGAN_EDUCATION_DATA, OrganEducationItem } from '../../data/organEducationData';
import { 
  RotateCw, 
  Sparkles, 
  ZoomIn, 
  ZoomOut, 
  Info, 
  ExternalLink, 
  Activity,
  Layers,
  Heart,
  BookOpen,
  User,
  Eye,
  CheckCircle2
} from 'lucide-react';

interface PhysiologicalNode {
  id: string;
  name: string;
  subname: string;
  category: string;
  color: number;
  hexColor: string;
  position: [number, number, number];
  targetTab: TabId;
  description: string;
  stats: string;
}

const NODES_DATA: PhysiologicalNode[] = [
  {
    id: 'metabolism',
    name: 'Metabolisme Energi & Makronutrien',
    subname: 'Glikolisis, Siklus Krebs & Pengeluaran Energi Basal',
    category: 'Biokimia Fisiologi',
    color: 0x10b981, // emerald
    hexColor: '#10b981',
    position: [0, 4.2, 0.8],
    targetTab: 'calculator',
    description: 'Model deterministik AST untuk BMR (Mifflin-St Jeor, Harris-Benedict) dan oksidasi substrat makronutrien.',
    stats: '14 Formula AST'
  },
  {
    id: 'cardio',
    name: 'Fisiologi Kardiovaskular & Vaskular',
    subname: 'Tekanan Arteri Rata-rata (MAP) & Resistensi Vaskular',
    category: 'Hemodinamika',
    color: 0xef4444, // red
    hexColor: '#ef4444',
    position: [-2.4, 3.4, -0.3],
    targetTab: 'registry',
    description: 'Persamaan hemodinamik sirkulasi darah, curah jantung, dan regulasi tekanan darah sistemik.',
    stats: '8 Parameter Terdaftar'
  },
  {
    id: 'bodycomp',
    name: 'Komposisi Tubuh & Antropometri',
    subname: 'Massa Bebas Lemak, Cairan Tubuh & Indeks Adipositas',
    category: 'Antropometri Klinis',
    color: 0x06b6d4, // cyan
    hexColor: '#06b6d4',
    position: [2.3, 3.5, 0.4],
    targetTab: 'datalab',
    description: 'Pipeline dataset antropometrik terisolasi imutabel dengan audit deviasi standar dan z-score WHO.',
    stats: 'Dataset Multiversi'
  },
  {
    id: 'fluids',
    name: 'Keseimbangan Cairan & Elektrolit',
    subname: 'Osmolalitas Plasma, Natrium & Kebutuhan Hidrasi',
    category: 'Homeostasis Seluler',
    color: 0x3b82f6, // blue
    hexColor: '#3b82f6',
    position: [-1.5, 5.2, 0.2],
    targetTab: 'experiments',
    description: 'Simulasi komparatif baseline vs eksperimental untuk fluktuasi cairan dan kompartemen intraseluler.',
    stats: 'Simulasi Sensitivitas'
  },
  {
    id: 'literature',
    name: 'Bank Materi & Modul PDF Ilmiah',
    subname: 'Monograf Guyton-Hall, Krause & Jurnal Internasional',
    category: 'Kepustakaan Klinis',
    color: 0xf59e0b, // amber
    hexColor: '#f59e0b',
    position: [1.7, 5.0, -0.5],
    targetTab: 'materials',
    description: 'Modul PDF ilmiah terindeks dengan anotasi sitasi ganda, penanda halaman, dan verifikasi SHA-256.',
    stats: 'Modul PDF & Jurnal'
  },
  {
    id: 'statistics',
    name: 'Biostatistika & Analisis Klinis',
    subname: 'Korelasi Pearson, Regresi Linear & Uji t-Student',
    category: 'Metodologi Penelitian',
    color: 0x8b5cf6, // purple
    hexColor: '#8b5cf6',
    position: [0.1, 6.2, 0.3],
    targetTab: 'statistics',
    description: 'Mesin inferensi statistik otomatis dengan pelaporan formal standar APA Edisi ke-7 dan uji asumsi.',
    stats: 'Justifikasi Bagian 39'
  }
];

export type CameraFocusMode = 'dual' | 'organs' | 'tree';

interface TreeOfLife3DProps {
  onNavigate: (tab: TabId) => void;
  onOpenOrganEducation?: (organId: string) => void;
}

export const TreeOfLife3D: React.FC<TreeOfLife3DProps> = ({ 
  onNavigate,
  onOpenOrganEducation 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [focusMode, setFocusMode] = useState<CameraFocusMode>('dual');
  const [activeHoverInfo, setActiveHoverInfo] = useState<{
    type: 'node' | 'organ';
    title: string;
    subtitle: string;
    badge: string;
    hexColor: string;
  } | null>(null);
  const [selectedNode, setSelectedNode] = useState<PhysiologicalNode | null>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  const [webGlAvailable, setWebGlAvailable] = useState<boolean | null>(null);

  // References to keep animation loop in sync with React state
  const focusModeRef = useRef(focusMode);
  focusModeRef.current = focusMode;
  const autoRotateRef = useRef(autoRotate);
  autoRotateRef.current = autoRotate;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    let animationFrameId: number;

    try {
      // Test WebGL support
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        setWebGlAvailable(false);
        return;
      }

      // 1. Scene & Renderer (Seamless slate-950 background)
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x020617); // Tailwind slate-950
      scene.fog = new THREE.FogExp2(0x020617, 0.038);

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 500;

      const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 100);
      camera.position.set(0, 4.2, 14.5);
      camera.lookAt(0, 3.8, -0.8);

      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, failIfMajorPerformanceCaveat: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.shadowMap.enabled = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.15;
      container.appendChild(renderer.domElement);
      setWebGlAvailable(true);

    // 2. Lighting setup
    const ambientLight = new THREE.AmbientLight(0x94a3b8, 0.95);
    scene.add(ambientLight);

    const mainLight = new THREE.DirectionalLight(0xffffff, 2.2);
    mainLight.position.set(6, 12, 8);
    scene.add(mainLight);

    const cyanRim = new THREE.PointLight(0x06b6d4, 3.5, 30);
    cyanRim.position.set(-7, 8, -5);
    scene.add(cyanRim);

    const emeraldBase = new THREE.PointLight(0x10b981, 3.0, 20);
    emeraldBase.position.set(0, 1, 4);
    scene.add(emeraldBase);

    const purpleAura = new THREE.PointLight(0x8b5cf6, 2.5, 25);
    purpleAura.position.set(3, 7, -4);
    scene.add(purpleAura);

    // Master Group for All Rotating Scene Elements
    const sceneWorldGroup = new THREE.Group();
    scene.add(sceneWorldGroup);

    // ---------------------------------------------------------
    // 3. TREE OF LIFE HIERARCHY (POHON KEHIDUPAN)
    // ---------------------------------------------------------
    const treeGroup = new THREE.Group();
    sceneWorldGroup.add(treeGroup);

    const barkMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.75,
      metalness: 0.2,
    });

    const rootMaterial = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
    });

    // Procedural Tree Trunk
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.6, 0),
      new THREE.Vector3(0.08, 1.2, 0.08),
      new THREE.Vector3(-0.12, 2.5, -0.08),
      new THREE.Vector3(0, 4.0, 0)
    ]);
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 32, 0.38, 16, false);
    const trunkMesh = new THREE.Mesh(trunkGeo, barkMaterial);
    treeGroup.add(trunkMesh);

    // Roots
    const rootCurves = [
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(-1.4, -0.8, 0.9), new THREE.Vector3(-2.2, -1.0, 1.3)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(1.3, -0.8, 0.8), new THREE.Vector3(2.0, -1.0, 1.2)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(-0.2, -0.8, -1.5), new THREE.Vector3(-0.4, -1.0, -2.2)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(1.2, -0.8, -1.1), new THREE.Vector3(1.8, -1.0, -1.8)])
    ];
    rootCurves.forEach(curve => {
      const geo = new THREE.TubeGeometry(curve, 20, 0.16, 10, false);
      const mesh = new THREE.Mesh(geo, rootMaterial);
      treeGroup.add(mesh);
    });

    // Primary Limbs reaching out to Physiological Nodes
    const branchCurves = [
      new THREE.CatmullRomCurve3([new THREE.Vector3(-0.1, 2.6, 0), new THREE.Vector3(-1.2, 3.0, -0.2), new THREE.Vector3(-2.4, 3.4, -0.3)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 2.8, 0), new THREE.Vector3(1.3, 3.1, 0.2), new THREE.Vector3(2.3, 3.5, 0.4)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 3.2, 0), new THREE.Vector3(0, 3.7, 0.5), new THREE.Vector3(0, 4.2, 0.8)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(-0.1, 3.8, 0), new THREE.Vector3(-0.8, 4.5, 0.1), new THREE.Vector3(-1.5, 5.2, 0.2)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0.1, 3.9, 0), new THREE.Vector3(0.9, 4.4, -0.3), new THREE.Vector3(1.7, 5.0, -0.5)]),
      new THREE.CatmullRomCurve3([new THREE.Vector3(0, 4.0, 0), new THREE.Vector3(0.1, 5.1, 0.15), new THREE.Vector3(0.1, 6.2, 0.3)])
    ];
    branchCurves.forEach(curve => {
      const geo = new THREE.TubeGeometry(curve, 24, 0.12, 12, false);
      const mesh = new THREE.Mesh(geo, barkMaterial);
      treeGroup.add(mesh);
    });

    // Foliage Bioluminescent Clusters
    const leafGeo = new THREE.IcosahedronGeometry(0.24, 1);
    const leafMaterial = new THREE.MeshStandardMaterial({
      color: 0x059669,
      roughness: 0.35,
      emissive: 0x065f46,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.88
    });

    const leafInstances: THREE.Mesh[] = [];
    for (let i = 0; i < 42; i++) {
      const theta = Math.random() * Math.PI * 2;
      const radius = 0.8 + Math.random() * 2.0;
      const height = 3.2 + Math.random() * 3.2;
      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;
      const y = height;

      const leaf = new THREE.Mesh(leafGeo, leafMaterial);
      leaf.position.set(x, y, z);
      const scale = 0.5 + Math.random() * 0.85;
      leaf.scale.set(scale, scale * 0.8, scale);
      treeGroup.add(leaf);
      leafInstances.push(leaf);
    }

    // Interactive Nodes for the Tree of Life
    const nodeMeshes: THREE.Mesh[] = [];
    const haloMeshes: THREE.Mesh[] = [];

    NODES_DATA.forEach((node) => {
      const sphereGeo = new THREE.SphereGeometry(0.36, 32, 32);
      const sphereMat = new THREE.MeshStandardMaterial({
        color: node.color,
        emissive: node.color,
        emissiveIntensity: 0.9,
        roughness: 0.2,
        metalness: 0.3
      });
      const nodeMesh = new THREE.Mesh(sphereGeo, sphereMat);
      nodeMesh.position.set(...node.position);
      nodeMesh.userData = { isTreeNode: true, nodeData: node };
      treeGroup.add(nodeMesh);
      nodeMeshes.push(nodeMesh);

      const haloGeo = new THREE.SphereGeometry(0.52, 20, 20);
      const haloMat = new THREE.MeshBasicMaterial({
        color: node.color,
        transparent: true,
        opacity: 0.28,
        wireframe: true
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.position.set(...node.position);
      treeGroup.add(haloMesh);
      haloMeshes.push(haloMesh);
    });

    // ---------------------------------------------------------
    // 4. HOLOGRAPHIC HUMAN ORGAN SYSTEM (DI BELAKANG POHON)
    // ---------------------------------------------------------
    const humanBodyGroup = new THREE.Group();
    // Positioned behind the tree with an elegant perspective offset
    humanBodyGroup.position.set(0, 0, -2.4);
    sceneWorldGroup.add(humanBodyGroup);

    // A. Holographic Wireframe Silhouette of Human Body
    const silhouetteMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.16
    });

    // Head
    const headGeo = new THREE.SphereGeometry(0.5, 16, 16);
    const headMesh = new THREE.Mesh(headGeo, silhouetteMat);
    headMesh.position.set(0, 5.5, 0);
    humanBodyGroup.add(headMesh);

    // Torso / Ribcage
    const torsoGeo = new THREE.CylinderGeometry(0.75, 0.6, 2.3, 16, 8, true);
    const torsoMesh = new THREE.Mesh(torsoGeo, silhouetteMat);
    torsoMesh.position.set(0, 3.8, 0);
    humanBodyGroup.add(torsoMesh);

    // Hips / Pelvis
    const hipsGeo = new THREE.CylinderGeometry(0.6, 0.5, 0.9, 14, 4, true);
    const hipsMesh = new THREE.Mesh(hipsGeo, silhouetteMat);
    hipsMesh.position.set(0, 2.2, 0);
    humanBodyGroup.add(hipsMesh);

    // Legs Silhouette
    const legGeo = new THREE.CylinderGeometry(0.2, 0.14, 2.4, 8, 4, true);
    const leftLeg = new THREE.Mesh(legGeo, silhouetteMat);
    leftLeg.position.set(-0.35, 0.6, 0);
    humanBodyGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, silhouetteMat);
    rightLeg.position.set(0.35, 0.6, 0);
    humanBodyGroup.add(rightLeg);

    // Spine Column (Glowing central nervous line)
    const spineCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 1.8, 0),
      new THREE.Vector3(0, 3.6, -0.05),
      new THREE.Vector3(0, 5.1, 0)
    ]);
    const spineGeo = new THREE.TubeGeometry(spineCurve, 20, 0.04, 8, false);
    const spineMat = new THREE.MeshBasicMaterial({
      color: 0x818cf8,
      transparent: true,
      opacity: 0.5
    });
    humanBodyGroup.add(new THREE.Mesh(spineGeo, spineMat));

    // B. Interactive 3D Organs inside the Hologram
    const organMeshes: THREE.Mesh[] = [];
    let heartPulsingMesh: THREE.Mesh | null = null;
    let lungsBreathingMesh: THREE.Mesh[] = [];

    ORGAN_EDUCATION_DATA.forEach((organ) => {
      let organGeo: THREE.BufferGeometry;
      const organMat = new THREE.MeshStandardMaterial({
        color: organ.color,
        emissive: organ.color,
        emissiveIntensity: 0.9,
        roughness: 0.25,
        metalness: 0.3
      });

      // Tailored anatomical shapes for each organ
      if (organ.id === 'heart') {
        organGeo = new THREE.DodecahedronGeometry(0.28, 1);
      } else if (organ.id === 'lungs') {
        organGeo = new THREE.CapsuleGeometry(0.22, 0.45, 8, 16);
      } else if (organ.id === 'stomach') {
        organGeo = new THREE.TorusGeometry(0.22, 0.12, 10, 20, Math.PI * 1.3);
      } else if (organ.id === 'liver') {
        organGeo = new THREE.ConeGeometry(0.36, 0.5, 6);
      } else if (organ.id === 'kidneys') {
        organGeo = new THREE.SphereGeometry(0.22, 16, 16);
      } else {
        // Brain
        organGeo = new THREE.SphereGeometry(0.35, 24, 24);
      }

      const organMesh = new THREE.Mesh(organGeo, organMat);
      // Map to the local humanBodyGroup position
      const localPos: [number, number, number] = [
        organ.position3D[0],
        organ.position3D[1],
        organ.position3D[2] - (-2.4) // offset relative to humanBodyGroup
      ];
      organMesh.position.set(...localPos);
      organMesh.userData = { isOrgan: true, organData: organ };
      humanBodyGroup.add(organMesh);
      organMeshes.push(organMesh);

      // Outer glowing halo
      const organHaloGeo = new THREE.SphereGeometry(0.42, 16, 16);
      const organHaloMat = new THREE.MeshBasicMaterial({
        color: organ.color,
        transparent: true,
        opacity: 0.3,
        wireframe: true
      });
      const halo = new THREE.Mesh(organHaloGeo, organHaloMat);
      halo.position.set(...localPos);
      humanBodyGroup.add(halo);
      haloMeshes.push(halo);

      if (organ.id === 'heart') {
        heartPulsingMesh = organMesh;
      }
      if (organ.id === 'lungs') {
        lungsBreathingMesh.push(organMesh);
        // Also add the second lung lobe for bilateral anatomy
        const rightLung = new THREE.Mesh(organGeo, organMat);
        rightLung.position.set(0.45, localPos[1], localPos[2]);
        rightLung.userData = { isOrgan: true, organData: organ };
        humanBodyGroup.add(rightLung);
        organMeshes.push(rightLung);
        lungsBreathingMesh.push(rightLung);
      }
    });

    // C. Vascular Circulatory Channels (Aorta & Vena Cava in 3D)
    const aortaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.15, 4.3, 0.05),
      new THREE.Vector3(0, 4.7, 0.02),
      new THREE.Vector3(0.08, 4.1, 0.0),
      new THREE.Vector3(0.05, 3.2, 0.0),
      new THREE.Vector3(0.05, 2.2, 0.0)
    ]);
    const aortaGeo = new THREE.TubeGeometry(aortaCurve, 24, 0.045, 8, false);
    const aortaMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.8 });
    humanBodyGroup.add(new THREE.Mesh(aortaGeo, aortaMat));

    const venaCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.06, 2.2, 0.0),
      new THREE.Vector3(-0.06, 3.4, 0.0),
      new THREE.Vector3(-0.12, 4.2, 0.04),
      new THREE.Vector3(-0.1, 4.9, 0.02)
    ]);
    const venaGeo = new THREE.TubeGeometry(venaCurve, 24, 0.045, 8, false);
    const venaMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.8 });
    humanBodyGroup.add(new THREE.Mesh(venaGeo, venaMat));

    // Bio-Energy Connecting Lines between Tree of Life & Human Body
    const bridgeCurve1 = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 4.0, 0), // from tree trunk
      new THREE.Vector3(-0.5, 4.2, -1.2),
      new THREE.Vector3(-0.35, 4.3, -2.4) // to heart
    ]);
    const bridgeGeo1 = new THREE.TubeGeometry(bridgeCurve1, 20, 0.02, 6, false);
    const bridgeMat = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.45 });
    sceneWorldGroup.add(new THREE.Mesh(bridgeGeo1, bridgeMat));

    // ---------------------------------------------------------
    // 5. FLOATING METABOLIC NUTRIENT PARTICLES (ATP & GLUKOSA)
    // ---------------------------------------------------------
    const particleCount = 160;
    const particleGeometry = new THREE.SphereGeometry(0.045, 6, 6);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
    });
    const particleInstanced = new THREE.InstancedMesh(particleGeometry, particleMaterial, particleCount);
    
    interface ParticleState {
      x: number;
      y: number;
      z: number;
      vx: number;
      vy: number;
      vz: number;
      scale: number;
    }
    const particleData: ParticleState[] = [];
    const particleDummy = new THREE.Object3D();

    for (let i = 0; i < particleCount; i++) {
      const p: ParticleState = {
        x: (Math.random() - 0.5) * 12,
        y: Math.random() * 8.5 - 0.5,
        z: (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * 0.006,
        vy: 0.005 + Math.random() * 0.009,
        vz: (Math.random() - 0.5) * 0.006,
        scale: 0.6 + Math.random() * 0.8
      };
      particleData.push(p);
      particleDummy.position.set(p.x, p.y, p.z);
      particleDummy.scale.set(p.scale, p.scale, p.scale);
      particleDummy.updateMatrix();
      particleInstanced.setMatrixAt(i, particleDummy.matrix);
    }
    particleInstanced.instanceMatrix.needsUpdate = true;
    scene.add(particleInstanced);

    // ---------------------------------------------------------
    // 6. RAYCASTING & INTERACTION
    // ---------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(-999, -999);
    const allInteractiveMeshes = [...nodeMeshes, ...organMeshes];

    const onPointerMove = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Subtle responsive parallax
      sceneWorldGroup.rotation.y = mouse.x * 0.12;
      sceneWorldGroup.rotation.x = -mouse.y * 0.06;
    };

    container.addEventListener('mousemove', onPointerMove);

    const onCanvasClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const clickMouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );

      raycaster.setFromCamera(clickMouse, camera);
      const intersects = raycaster.intersectObjects(allInteractiveMeshes);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        if (hit.userData.isOrgan) {
          const organData = hit.userData.organData as OrganEducationItem;
          if (onOpenOrganEducation) {
            onOpenOrganEducation(organData.id);
          }
          setFocusMode('organs');
        } else if (hit.userData.isTreeNode) {
          const nodeData = hit.userData.nodeData as PhysiologicalNode;
          setSelectedNode(nodeData);
          setFocusMode('tree');
        }
      } else {
        // Toggle view focus when clicking empty canvas
        setFocusMode(prev => {
          if (prev === 'dual') return 'organs';
          if (prev === 'organs') return 'tree';
          return 'dual';
        });
      }
    };

    container.addEventListener('click', onCanvasClick);

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // ---------------------------------------------------------
    // 7. ANIMATION LOOP
    // ---------------------------------------------------------
    let animationFrameId: number;
    let clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Camera position interpolation based on focus mode
      let targetZ = 14.5;
      let targetY = 4.2;
      let targetLookY = 3.8;
      let targetLookZ = -0.8;

      if (focusModeRef.current === 'organs') {
        // Zoom close to human organs
        targetZ = 6.2;
        targetY = 4.2;
        targetLookY = 4.0;
        targetLookZ = -2.2;
      } else if (focusModeRef.current === 'tree') {
        // Zoom into tree crown
        targetZ = 6.8;
        targetY = 4.5;
        targetLookY = 4.2;
        targetLookZ = 0.2;
      } else {
        // Dual panoramic view
        targetZ = 14.5;
        targetY = 4.2;
        targetLookY = 3.8;
        targetLookZ = -0.8;
      }

      camera.position.z += (targetZ - camera.position.z) * 0.05;
      camera.position.y += (targetY - camera.position.y) * 0.05;
      camera.lookAt(0, targetLookY, targetLookZ);

      // Auto rotation of scene
      if (autoRotateRef.current) {
        sceneWorldGroup.rotation.y += 0.003;
      }

      // Realistic Heartbeat Pulse (Lub-Dub rhythm)
      if (heartPulsingMesh) {
        const beatCycle = (elapsedTime * 1.3) % 1;
        let heartScale = 1.0;
        if (beatCycle < 0.15) {
          heartScale = 1.0 + Math.sin((beatCycle / 0.15) * Math.PI) * 0.22;
        } else if (beatCycle < 0.35) {
          heartScale = 1.0 + Math.sin(((beatCycle - 0.15) / 0.2) * Math.PI) * 0.14;
        }
        heartPulsingMesh.scale.set(heartScale, heartScale, heartScale);
      }

      // Respiratory expansion for lungs
      if (lungsBreathingMesh.length > 0) {
        const breath = 1.0 + Math.sin(elapsedTime * 0.8) * 0.1;
        lungsBreathingMesh.forEach(lung => {
          lung.scale.set(breath, breath, breath);
        });
      }

      // Pulsing halos
      haloMeshes.forEach((halo, idx) => {
        const scale = 1 + Math.sin(elapsedTime * 2.2 + idx) * 0.1;
        halo.scale.set(scale, scale, scale);
      });

      // Floating foliage slight breeze
      leafInstances.forEach((leaf) => {
        leaf.rotation.y += 0.0025;
      });

      // Floating nutrients/particles upward motion
      for (let i = 0; i < particleCount; i++) {
        const p = particleData[i];
        p.y += p.vy;
        p.x += Math.sin(elapsedTime + i) * 0.0018;

        if (p.y > 9.0) {
          p.y = -0.5;
        }

        particleDummy.position.set(p.x, p.y, p.z);
        particleDummy.scale.set(p.scale, p.scale, p.scale);
        particleDummy.updateMatrix();
        particleInstanced.setMatrixAt(i, particleDummy.matrix);
      }
      particleInstanced.instanceMatrix.needsUpdate = true;

      // Raycasting check for tooltip
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(allInteractiveMeshes);

      if (intersects.length > 0) {
        const hit = intersects[0].object;
        if (hit.userData.isOrgan) {
          const o = hit.userData.organData as OrganEducationItem;
          setActiveHoverInfo({
            type: 'organ',
            title: o.name,
            subtitle: `${o.latinName} • Klik untuk Pelajari Cara Kerja`,
            badge: o.category,
            hexColor: o.hexColor
          });
        } else if (hit.userData.isTreeNode) {
          const n = hit.userData.nodeData as PhysiologicalNode;
          setActiveHoverInfo({
            type: 'node',
            title: n.name,
            subtitle: n.subname,
            badge: n.category,
            hexColor: n.hexColor
          });
        }
        container.style.cursor = 'pointer';
      } else {
        setActiveHoverInfo(null);
        container.style.cursor = 'default';
      }

      renderer.render(scene, camera);
    };

    animate();

      return () => {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        window.removeEventListener('resize', handleResize);
        container.removeEventListener('mousemove', onPointerMove);
        container.removeEventListener('click', onCanvasClick);
        if (renderer && renderer.domElement && container.contains(renderer.domElement)) {
          container.removeChild(renderer.domElement);
        }
        if (renderer) renderer.dispose();
      };
    } catch (e) {
      console.warn('WebGL initialization failed, falling back to 2D schematic:', e);
      setWebGlAvailable(false);
    }
  }, []);

  if (webGlAvailable === false) {
    return (
      <div className="relative w-full rounded-3xl overflow-hidden bg-slate-950 border border-slate-800 p-6 shadow-2xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-4 border-b border-slate-800/80 gap-3">
          <div className="flex items-center space-x-2">
            <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Pohon Kehidupan & Organ Fisiologi Manusia</span>
            </span>
            <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
              2D Skematik
            </span>
          </div>
          <button
            onClick={() => onOpenOrganEducation && onOpenOrganEducation('heart')}
            className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/60 transition-all"
          >
            <Heart className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            <span>Pelajari Cara Kerja Organ Tubuh</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
          {NODES_DATA.map((node: PhysiologicalNode) => (
            <div
              key={node.id}
              onClick={() => onNavigate(node.targetTab)}
              className="group/card relative p-4 rounded-2xl bg-slate-900/80 hover:bg-slate-900 border border-slate-800/80 hover:border-slate-700 transition-all cursor-pointer hover:shadow-xl flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span
                    className="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-semibold"
                    style={{ backgroundColor: `${node.hexColor}20`, color: node.hexColor }}
                  >
                    {node.category}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover/card:text-white transition-colors" />
                </div>
                <h4 className="text-sm font-bold text-white group-hover/card:text-emerald-300 transition-colors">
                  {node.name}
                </h4>
                <p className="text-xs text-slate-400 font-mono mt-0.5 mb-2">
                  {node.subname}
                </p>
                <p className="text-xs text-slate-300 leading-relaxed line-clamp-2">
                  {node.description}
                </p>
              </div>
              <div className="mt-3 pt-2.5 border-t border-slate-800/60 flex items-center justify-between text-[11px] font-mono text-slate-400">
                <span>Metrik:</span>
                <span className="text-emerald-400 font-semibold">{node.stats}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[480px] sm:h-[530px] rounded-3xl overflow-hidden bg-slate-950 select-none group">
      {/* 3D WebGL Canvas Container */}
      <div 
        ref={containerRef} 
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Seamless radial vignette that smoothly merges canvas into the dashboard background */}
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-slate-950 via-transparent to-slate-950/40" />
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-r from-slate-950/30 via-transparent to-slate-950/30" />

      {/* Top Left Title & Indicator */}
      <div className="absolute top-4 left-4 z-10 pointer-events-none flex flex-col space-y-1">
        <div className="flex items-center space-x-2">
          <span className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 backdrop-blur-md">
            <Sparkles className="w-3.5 h-3.5 animate-spin-slow" />
            <span>Pohon Kehidupan & Organ Fisiologi Manusia 3D</span>
          </span>
          <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-900/90 text-slate-300 border border-slate-700/80">
            WebGL Sinergis
          </span>
        </div>
        <p className="text-xs text-slate-300 drop-shadow-sm max-w-md hidden sm:block">
          Pohon Kehidupan metabolisme di depan, bersinergi dengan hologram sistem organ manusia di belakangnya.
        </p>
      </div>

      {/* Top Right Controls HUD */}
      <div className="absolute top-4 right-4 z-20 flex flex-col space-y-2">
        {/* Focus Mode Selector */}
        <div className="bg-slate-900/90 backdrop-blur-md p-1 rounded-2xl border border-slate-800 flex items-center space-x-1 shadow-xl">
          <button
            onClick={() => setFocusMode('dual')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1 ${
              focusMode === 'dual'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Tampilan Penuh Pohon & Organ"
          >
            <Layers className="w-3 h-3" />
            <span>Sinergi Penuh</span>
          </button>

          <button
            onClick={() => setFocusMode('organs')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1 ${
              focusMode === 'organs'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Fokus Mendekat ke Organ Tubuh Manusia"
          >
            <User className="w-3 h-3" />
            <span>Organ Tubuh</span>
          </button>

          <button
            onClick={() => setFocusMode('tree')}
            className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all flex items-center space-x-1 ${
              focusMode === 'tree'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
            title="Fokus Mendekat ke Pohon Kehidupan"
          >
            <Sparkles className="w-3 h-3" />
            <span>Pohon Riset</span>
          </button>
        </div>

        {/* Action button to open full organ education */}
        <button
          onClick={() => onOpenOrganEducation && onOpenOrganEducation('heart')}
          className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-700/60 shadow-lg backdrop-blur-md transition-all self-end"
        >
          <Heart className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
          <span>Cara Kerja Organ Tubuh</span>
        </button>

        {/* Toggle Auto Rotation */}
        <button
          onClick={() => setAutoRotate(prev => !prev)}
          className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-medium backdrop-blur-md border transition-all self-end ${
            autoRotate
              ? 'bg-slate-900/80 text-slate-200 border-slate-700 hover:bg-slate-800'
              : 'bg-slate-950/80 text-slate-500 border-slate-800 hover:text-slate-200'
          }`}
        >
          <RotateCw className={`w-3.5 h-3.5 ${autoRotate ? 'text-emerald-400' : 'text-slate-500'}`} />
          <span>{autoRotate ? 'Rotasi Aktif' : 'Rotasi Diam'}</span>
        </button>
      </div>

      {/* Interactive Helper Banner at Bottom */}
      <div className="absolute bottom-3 left-4 right-4 z-10 pointer-events-none flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
        <div className="flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-slate-800 pointer-events-auto shadow-md">
          <Info className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span>
            {focusMode === 'organs'
              ? 'Mode Organ: Klik organ mana saja untuk mempelajari mekanisme kerja biokimia tubuh.'
              : focusMode === 'tree'
              ? 'Mode Pohon: Klik simpul fisiologis untuk membuka kalkulator dan registri AST.'
              : 'Klik di kanvas untuk berganti fokus kamera atau pilih organ berdetak di belakang pohon.'}
          </span>
        </div>

        <div className="flex items-center space-x-2 bg-slate-900/90 backdrop-blur-md px-3.5 py-1.5 rounded-xl border border-slate-800 text-[11px] font-mono text-slate-300 pointer-events-auto">
          <Activity className="w-3.5 h-3.5 text-emerald-400" />
          <span>6 Organ Fisiologis + 6 Cabang Riset Terhubung</span>
        </div>
      </div>

      {/* Hovered Item Tooltip */}
      {activeHoverInfo && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-20 pointer-events-none animate-in fade-in zoom-in-95 duration-150">
          <div className="bg-slate-900/95 text-white backdrop-blur-md px-4 py-2.5 rounded-2xl border border-slate-700 shadow-2xl flex items-center space-x-3 text-xs max-w-md">
            <div 
              className="w-3.5 h-3.5 rounded-full shrink-0 animate-ping"
              style={{ backgroundColor: activeHoverInfo.hexColor }}
            />
            <div>
              <div className="font-bold text-white flex items-center space-x-1.5">
                <span>{activeHoverInfo.title}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                  {activeHoverInfo.badge}
                </span>
              </div>
              <p className="text-[11px] text-slate-300 leading-snug mt-0.5">
                {activeHoverInfo.subtitle}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Selected Tree Node Modal Drawer */}
      {selectedNode && (
        <div className="absolute inset-y-4 right-4 w-80 z-30 bg-slate-950/95 backdrop-blur-md text-white border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <span 
                className="text-[10px] font-mono uppercase px-2 py-0.5 rounded font-bold"
                style={{ backgroundColor: `${selectedNode.hexColor}25`, color: selectedNode.hexColor }}
              >
                {selectedNode.category}
              </span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-slate-400 hover:text-white text-xs px-2 py-0.5 rounded hover:bg-slate-800"
              >
                ✕ Tutup
              </button>
            </div>

            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                {selectedNode.name}
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {selectedNode.subname}
              </p>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-900/60 p-3 rounded-2xl border border-slate-800">
              {selectedNode.description}
            </p>

            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
              <span>Metrik Terkoneksi:</span>
              <span className="text-emerald-400 font-semibold">{selectedNode.stats}</span>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 space-y-2">
            <button
              onClick={() => {
                onNavigate(selectedNode.targetTab);
                setSelectedNode(null);
              }}
              className="w-full inline-flex items-center justify-center space-x-2 px-4 py-2.5 rounded-xl font-bold text-xs text-slate-950 transition-all hover:scale-[1.02] shadow-lg"
              style={{ backgroundColor: selectedNode.hexColor }}
            >
              <span>Buka Modul Laboratorium</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setSelectedNode(null)}
              className="w-full text-center text-xs text-slate-400 hover:text-slate-200 py-1"
            >
              Lanjutkan Eksplorasi 3D
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

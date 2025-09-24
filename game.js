// --- UTILITY FUNCTIONS ---
// Linear interpolation function, required for the noise generator
function lerp(a, b, t) {
    return a + (b - a) * t;
}

// Thompson's simple noise function for enemy car drift
function SimpleNoise() {
    const G = new Uint8Array(512);
    for (let i = 0; i < 256; i++) G[i] = i;
    for (let i = 255; i > 0; i--) {
        const r = Math.floor(Math.random() * (i + 1));
        [G[i], G[r]] = [G[r], G[i]];
    }
    for (let i = 0; i < 256; i++) G[i + 256] = G[i];

    const grad = (h, x, y) => (h & 1 ? x : -x) + (h & 2 ? y : -y);
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

    this.noise = (x, y) => {
        const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
        x -= Math.floor(x); y -= Math.floor(y);
        const u = fade(x), v = fade(y);
        const a = G[X] + Y, b = G[X + 1] + Y;
        const h1 = G[a], h2 = G[b], h3 = G[a + 1], h4 = G[b + 1];
        return lerp(lerp(grad(h1, x, y), grad(h2, x - 1, y), u),
                    lerp(grad(h3, x, y - 1), grad(h4, x - 1, y - 1), u), v);
    };
}
const noiseGen = new SimpleNoise();

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10102a);
// Fog adjusted to be closer, like the original video
scene.fog = new THREE.Fog(0x10102a, 20, 50);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 4, -8);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- LIGHTS ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
scene.add(directionalLight);

// --- GAME STATE & CONSTANTS (Undivided Road Setup) ---
const ROAD_WIDTH = 12;
const SEGMENT_LENGTH = 100;
const NUM_SEGMENTS = 3;
const LANE_WIDTH = ROAD_WIDTH / 3;
const LANE_POSITIONS = [-LANE_WIDTH, 0, LANE_WIDTH];

let gameState = {
    running: true,
    score: 0,
    startTime: Date.now(),
    enemySpawnTimer: 0,
    enemySpawnRate: 1.5, // seconds
    enemyBaseSpeed: 0.1
};

// --- UI ELEMENTS ---
const scoreElement = document.getElementById('score');
const speedElement = document.getElementById('speed');
const gameOverScreen = document.getElementById('game-over-screen');
const finalScoreElement = document.getElementById('final-score');
const restartButton = document.getElementById('restart-button');
const restartTopButton = document.getElementById('restart-top-button');
const steerLeftButton = document.getElementById('steer-left');
const steerRightButton = document.getElementById('steer-right');


// --- WORLD CREATION (Endless) ---
let worldSegments = [];

function createWorldSegment(index) {
    const segmentGroup = new THREE.Group();
    
    // Create reusable geometries and materials
    const roadGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, SEGMENT_LENGTH);
    const roadMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const grassGeometry = new THREE.PlaneGeometry(1000, SEGMENT_LENGTH);
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x1f511f });
    
    // Road
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    segmentGroup.add(road);

    // Grass
    const leftGrass = new THREE.Mesh(grassGeometry, grassMaterial);
    leftGrass.position.set(-(ROAD_WIDTH / 2 + 500), -0.01, 0);
    leftGrass.rotation.x = -Math.PI / 2;
    leftGrass.receiveShadow = true;
    segmentGroup.add(leftGrass);

    const rightGrass = new THREE.Mesh(grassGeometry, grassMaterial);
    rightGrass.position.set(ROAD_WIDTH / 2 + 500, -0.01, 0);
    rightGrass.rotation.x = -Math.PI / 2;
    rightGrass.receiveShadow = true;
    segmentGroup.add(rightGrass);
    
    // Dashed lines texture
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 16, 40);
    const lineTexture = new THREE.CanvasTexture(canvas);
    lineTexture.wrapS = THREE.RepeatWrapping;
    lineTexture.wrapT = THREE.RepeatWrapping;
    lineTexture.repeat.set(1, SEGMENT_LENGTH / 3);
    const lineMaterial = new THREE.MeshBasicMaterial({ map: lineTexture, transparent: true });
    const lineGeometry = new THREE.PlaneGeometry(0.2, SEGMENT_LENGTH);
    
    // Undivided road lines
    const leftLine = new THREE.Mesh(lineGeometry, lineMaterial);
    leftLine.position.set(-LANE_WIDTH / 2, 0.01, 0);
    leftLine.rotation.x = -Math.PI / 2;
    segmentGroup.add(leftLine);
    
    const rightLine = new THREE.Mesh(lineGeometry, lineMaterial);
    rightLine.position.set(LANE_WIDTH / 2, 0.01, 0);
    rightLine.rotation.x = -Math.PI / 2;
    segmentGroup.add(rightLine);

    // Position the whole segment
    segmentGroup.position.z = index * SEGMENT_LENGTH;
    
    scene.add(segmentGroup);
    worldSegments.push(segmentGroup);
}

// Create initial segments to fill the screen
for (let i = 0; i < NUM_SEGMENTS; i++) {
    createWorldSegment(i);
}

function updateWorld() {
    const playerZ = playerCar.position.z;
    worldSegments.forEach(segment => {
        if (segment.position.z + SEGMENT_LENGTH < playerZ) {
            segment.position.z += NUM_SEGMENTS * SEGMENT_LENGTH;
        }
    });
}


// --- PLAYER CAR ---
let playerCar;
let playerCarBoundingBox;
let playerPhysics = {
    speed: 0,
    acceleration: 0.005,
    friction: 0.98,
    maxSpeed: 0.5,
    steerSpeed: 0.04,
};
const keys = {};

function createPlayerCar() {
    const car = new THREE.Group();

    const bodyGeometry = new THREE.BoxGeometry(2, 0.8, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    car.add(body);

    const cabinGeometry = new THREE.BoxGeometry(1.6, 0.6, 2);
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.position.set(0, 0.7, -0.5);
    cabin.castShadow = true;
    car.add(cabin);

    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheels = [];
    const wheelPositions = [
        new THREE.Vector3(-1.1, -0.1, 1.5), new THREE.Vector3(1.1, -0.1, 1.5),
        new THREE.Vector3(-1.1, -0.1, -1.5), new THREE.Vector3(1.1, -0.1, -1.5),
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.copy(pos);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        car.add(wheel);
        wheels.push(wheel);
    });
    car.wheels = wheels;
    
    const headlightGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16);
    const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 });
    const leftLight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    leftLight.position.set(-0.7, 0.1, 2.05);
    leftLight.rotation.x = Math.PI / 2;
    car.add(leftLight);
    
    const rightLight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    rightLight.position.set(0.7, 0.1, 2.05);
    rightLight.rotation.x = Math.PI / 2;
    car.add(rightLight);

    // Add functional PointLights for headlights
    const leftPointLight = new THREE.PointLight(0xffffff, 1, 20);
    leftPointLight.position.set(-0.7, 0.2, 2.1);
    car.add(leftPointLight);

    const rightPointLight = new THREE.PointLight(0xffffff, 1, 20);
    rightPointLight.position.set(0.7, 0.2, 2.1);
    car.add(rightPointLight);

    // Add Taillights
    const taillightGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.1);
    const taillightMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xdd0000, emissiveIntensity: 0 }); // Initially off
    const leftTailLight = new THREE.Mesh(taillightGeometry, taillightMaterial);
    leftTailLight.position.set(-0.7, 0.1, -2.05);
    car.add(leftTailLight);
    
    const rightTailLight = new THREE.Mesh(taillightGeometry, taillightMaterial.clone());
    rightTailLight.position.set(0.7, 0.1, -2.05);
    car.add(rightTailLight);
    car.taillights = [leftTailLight, rightTailLight];

    car.position.y = 0.5;
    scene.add(car);
    return car;
}

playerCar = createPlayerCar(); // Starts at (0, 0.5, 0) by default
playerCarBoundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());

// --- ENEMY CARS ---
let enemyCars = [];
const enemyColors = [0x0000ff, 0x00ff00, 0xffff00, 0xff00ff, 0x00ffff, 0x888888];

function createEnemyCar() {
    const car = new THREE.Group();
    const color = enemyColors[Math.floor(Math.random() * enemyColors.length)];

    const bodyGeometry = new THREE.BoxGeometry(2, 0.8, 4);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    car.add(body);

    const cabinGeometry = new THREE.BoxGeometry(1.6, 0.6, 2);
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.position.set(0, 0.7, -0.5);
    cabin.castShadow = true;
    car.add(cabin);
    
    // Add wheels to enemy cars
    const wheelGeometry = new THREE.CylinderGeometry(0.4, 0.4, 0.3, 16);
    const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const wheelPositions = [
        new THREE.Vector3(-1.1, -0.1, 1.5), new THREE.Vector3(1.1, -0.1, 1.5),
        new THREE.Vector3(-1.1, -0.1, -1.5), new THREE.Vector3(1.1, -0.1, -1.5),
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
        wheel.position.copy(pos);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        car.add(wheel);
    });

    // Add headlights to enemy cars
    const headlightGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16);
    const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xffffaa, emissive: 0xffffaa, emissiveIntensity: 1 });
    const leftLight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    leftLight.position.set(-0.7, 0.1, 2.05);
    leftLight.rotation.x = Math.PI / 2;
    car.add(leftLight);
    
    const rightLight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    rightLight.position.set(0.7, 0.1, 2.05);
    rightLight.rotation.x = Math.PI / 2;
    car.add(rightLight);

    // Add functional PointLights for headlights
    const leftPointLight = new THREE.PointLight(0xffffff, 1, 20);
    leftPointLight.position.set(-0.7, 0.2, 2.1);
    car.add(leftPointLight);

    const rightPointLight = new THREE.PointLight(0xffffff, 1, 20);
    rightPointLight.position.set(0.7, 0.2, 2.1);
    car.add(rightPointLight);

    car.position.y = 0.5;
    car.rotation.y = Math.PI;
    
    // Spawn in any of the three lanes
    const lane = LANE_POSITIONS[Math.floor(Math.random() * LANE_POSITIONS.length)];
    car.position.x = lane;
    car.position.z = playerCar.position.z + 60 + Math.random() * 60;
    
    const driftNoise = Math.random() * 2 - 1;
    const enemy = {
        mesh: car,
        boundingBox: new THREE.Box3(new THREE.Vector3(), new THREE.Vector3()),
        speed: gameState.enemyBaseSpeed + Math.random() * 0.1,
        drift: (noiseGen.noise(car.position.z * 0.1, driftNoise) * 0.01)
    };
    
    scene.add(car);
    enemyCars.push(enemy);
}

// --- CONTROLS & MOVEMENT ---
document.addEventListener('keydown', (e) => keys[e.key.toLowerCase()] = true);
document.addEventListener('keyup', (e) => keys[e.key.toLowerCase()] = false);

function updatePlayerCar() {
    let braking = false;
    // Acceleration/Braking
    if (keys['arrowup'] || keys['w']) {
        playerPhysics.speed += playerPhysics.acceleration;
    }
    if (keys['arrowdown'] || keys['s']) {
        playerPhysics.speed -= playerPhysics.acceleration * 1.5;
        braking = true;
    }
    
    // Turn on taillights if braking or reversing
    const taillightIntensity = (braking || playerPhysics.speed < -0.01) ? 1 : 0;
    playerCar.taillights.forEach(light => {
        light.material.emissiveIntensity = taillightIntensity;
    });

    playerPhysics.speed = Math.max(-playerPhysics.maxSpeed / 2, Math.min(playerPhysics.maxSpeed, playerPhysics.speed));
    playerPhysics.speed *= playerPhysics.friction;
    if (Math.abs(playerPhysics.speed) < 0.001) playerPhysics.speed = 0;

    // Steering
    if (keys['arrowleft'] || keys['a']) playerCar.position.x -= playerPhysics.steerSpeed;
    if (keys['arrowright'] || keys['d']) playerCar.position.x += playerPhysics.steerSpeed;
    
    // Clamp player car to road boundaries
    playerCar.position.x = Math.max(-ROAD_WIDTH/2 + 1, Math.min(ROAD_WIDTH/2 - 1, playerCar.position.x));
    
    playerCar.position.z += playerPhysics.speed;

    playerCar.wheels.forEach(wheel => { wheel.rotation.x -= playerPhysics.speed * 2; });
    playerCarBoundingBox.setFromObject(playerCar);
}

function updateCamera() {
    const targetPosition = new THREE.Vector3(playerCar.position.x, playerCar.position.y + 4, playerCar.position.z - 8);
    camera.position.lerp(targetPosition, 0.1);
    
    const lookAtTarget = new THREE.Vector3(playerCar.position.x, playerCar.position.y, playerCar.position.z + 5);
    camera.lookAt(lookAtTarget);
}

// --- GAME LOGIC & LOOP ---
function updateEnemies(dt) {
    gameState.enemySpawnTimer += dt;
    if (gameState.enemySpawnTimer > gameState.enemySpawnRate) {
        createEnemyCar();
        gameState.enemySpawnTimer = 0;
    }
    
    for (let i = enemyCars.length - 1; i >= 0; i--) {
        const enemy = enemyCars[i];
        enemy.mesh.position.z -= enemy.speed;
        enemy.mesh.position.x += enemy.drift;

        if (enemy.mesh.position.z < playerCar.position.z - 20) {
            scene.remove(enemy.mesh);
            enemyCars.splice(i, 1);
            continue;
        }

        enemy.boundingBox.setFromObject(enemy.mesh);
        if (playerCarBoundingBox.intersectsBox(enemy.boundingBox)) {
            gameOver();
            break;
        }
    }
}

function updateHUD() {
    if (gameState.running) {
        const elapsedTime = (Date.now() - gameState.startTime) / 1000;
        gameState.score = Math.floor(elapsedTime * 100 * (1 + Math.abs(playerPhysics.speed * 2)));
        scoreElement.textContent = gameState.score;
    }
    speedElement.textContent = (Math.abs(playerPhysics.speed) * 100).toFixed(2);
}

function updateDifficulty() {
    const elapsedTime = (Date.now() - gameState.startTime) / 1000;
    gameState.enemySpawnRate = Math.max(0.2, 1.5 - elapsedTime * 0.01);
    gameState.enemyBaseSpeed = Math.min(0.4, 0.1 + elapsedTime * 0.002);
}

function gameOver() {
    if (!gameState.running) return;
    gameState.running = false;
    finalScoreElement.textContent = gameState.score;
    gameOverScreen.style.display = 'flex';
    restartTopButton.style.display = 'none';
}

function restartGame() {
    gameState.running = true;
    gameState.score = 0;
    gameState.startTime = Date.now();
    gameState.enemySpawnTimer = 0;
    gameState.enemySpawnRate = 1.5;
    gameState.enemyBaseSpeed = 0.1;
    
    playerCar.position.set(0, 0.5, 0); // Reset to center
    playerPhysics.speed = 0;
    
    worldSegments.forEach((segment, i) => {
        segment.position.z = i * SEGMENT_LENGTH;
    });

    enemyCars.forEach(enemy => scene.remove(enemy.mesh));
    enemyCars = [];
    
    gameOverScreen.style.display = 'none';
    restartTopButton.style.display = 'block';

    animate();
}

restartButton.addEventListener('click', restartGame);
restartTopButton.addEventListener('click', restartGame);

const clock = new THREE.Clock();
function animate() {
    if (!gameState.running) return;
    
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    updatePlayerCar();
    updateCamera();
    updateEnemies(dt);
    updateHUD();
    updateDifficulty();
    updateWorld();
    
    renderer.render(scene, camera);
}

// --- EVENT LISTENERS ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Steer Left Button (>)
steerLeftButton.addEventListener('mousedown', () => keys['arrowleft'] = true);
steerLeftButton.addEventListener('mouseup', () => keys['arrowleft'] = false);
steerLeftButton.addEventListener('mouseleave', () => keys['arrowleft'] = false); 
steerLeftButton.addEventListener('touchstart', (e) => { e.preventDefault(); keys['arrowleft'] = true; }, { passive: false });
steerLeftButton.addEventListener('touchend', () => keys['arrowleft'] = false);

// Steer Right Button (<)
steerRightButton.addEventListener('mousedown', () => keys['arrowright'] = true);
steerRightButton.addEventListener('mouseup', () => keys['arrowright'] = false);
steerRightButton.addEventListener('mouseleave', () => keys['arrowright'] = false);
steerRightButton.addEventListener('touchstart', (e) => { e.preventDefault(); keys['arrowright'] = true; }, { passive: false });
steerRightButton.addEventListener('touchend', () => keys['arrowright'] = false);

// --- START GAME ---
animate();


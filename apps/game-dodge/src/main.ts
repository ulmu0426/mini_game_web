import Phaser from "phaser";
import { createGameMessenger } from "@minigame/sdk";

const GAME_SLUG = "dodge";
const scoreEl = document.getElementById("score") as HTMLDivElement;
const gameOverEl = document.getElementById("game-over") as HTMLDivElement;
const finalScoreEl = document.getElementById("final-score") as HTMLParagraphElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;

const getHubOrigin = () => {
  if (document.referrer) {
    try {
      return new URL(document.referrer).origin;
    } catch {
      return window.location.origin;
    }
  }
  return window.location.origin;
};

const messenger = createGameMessenger(window.parent, getHubOrigin());

class DodgeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Rectangle;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keysA!: Phaser.Input.Keyboard.Key;
  private keysD!: Phaser.Input.Keyboard.Key;
  private obstacles!: Phaser.Physics.Arcade.Group;
  private spawnTimer = 0;
  private elapsedMs = 0;
  private gameIsOver = false;

  constructor() {
    super("dodge-scene");
  }

  create() {
    const { width, height } = this.scale;
    this.spawnTimer = 0;
    this.elapsedMs = 0;
    this.gameIsOver = false;
    scoreEl.textContent = "Score: 0";

    this.player = this.add.rectangle(width / 2, height - 40, 70, 18, 0x38bdf8);
    this.physics.add.existing(this.player);
    const playerBody = this.player.body as Phaser.Physics.Arcade.Body;
    playerBody.setCollideWorldBounds(true);
    playerBody.setAllowGravity(false);
    playerBody.setImmovable(true);

    this.obstacles = this.physics.add.group();
    this.cursors = this.input.keyboard?.createCursorKeys() as Phaser.Types.Input.Keyboard.CursorKeys;
    this.keysA = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A) as Phaser.Input.Keyboard.Key;
    this.keysD = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D) as Phaser.Input.Keyboard.Key;

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (this.gameIsOver) {
        return;
      }
      this.player.x = Phaser.Math.Clamp(pointer.x, 35, width - 35);
    });

    this.physics.add.overlap(this.player, this.obstacles, () => {
      this.onGameOver();
    });

    messenger.ready(GAME_SLUG);
  }

  update(_: number, delta: number) {
    if (this.gameIsOver) {
      return;
    }

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const speed = 420;
    body.setVelocityX(0);
    if (this.cursors.left.isDown || this.keysA.isDown) {
      body.setVelocityX(-speed);
    } else if (this.cursors.right.isDown || this.keysD.isDown) {
      body.setVelocityX(speed);
    }

    this.spawnTimer += delta;
    this.elapsedMs += delta;
    scoreEl.textContent = `Score: ${Math.floor(this.elapsedMs / 1000)}`;

    if (this.spawnTimer > 500) {
      this.spawnTimer = 0;
      this.spawnObstacle();
    }

    this.obstacles.children.iterate((entry) => {
      const obstacle = entry as Phaser.GameObjects.Rectangle | null;
      if (!obstacle) {
        return false;
      }
      if (obstacle.y > this.scale.height + 40) {
        obstacle.destroy();
      }
      return false;
    });
  }

  private spawnObstacle() {
    const { width } = this.scale;
    const obstacle = this.add.rectangle(
      Phaser.Math.Between(12, width - 12),
      -20,
      Phaser.Math.Between(16, 30),
      Phaser.Math.Between(16, 30),
      0xf97316
    );

    this.physics.add.existing(obstacle);
    const body = obstacle.body as Phaser.Physics.Arcade.Body;
    body.setVelocityY(Phaser.Math.Between(170, 290));
    body.setAllowGravity(false);
    this.obstacles.add(obstacle);
  }

  private onGameOver() {
    if (this.gameIsOver) {
      return;
    }
    this.gameIsOver = true;
    const score = Math.floor(this.elapsedMs / 1000);
    finalScoreEl.textContent = `Your Score: ${score}`;
    gameOverEl.style.display = "block";
    messenger.submitScore({ gameSlug: GAME_SLUG, score });
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: window.innerWidth,
  height: window.innerHeight,
  backgroundColor: "#0b1220",
  physics: {
    default: "arcade",
    arcade: {
      debug: false
    }
  },
  scene: [DodgeScene],
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  }
});

restartBtn.addEventListener("click", () => {
  gameOverEl.style.display = "none";
  const scene = game.scene.getScene("dodge-scene") as DodgeScene;
  scene.scene.restart();
});

const disposeInit = messenger.onInit(() => {
  return;
});

window.addEventListener("beforeunload", () => {
  disposeInit();
  game.destroy(true);
});

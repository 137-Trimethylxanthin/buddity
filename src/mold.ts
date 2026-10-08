// Lets a body mold against screen edges: every vertex that would poke through a
// wall is pressed onto it, so pushed into a corner he fills the corner instead
// of squashing into an oval. The press is soft (a smooth max, not a clamp): the
// mesh rounds into the wall and never folds over itself, which would leave holes.
// Walls are given in world units (y up).
import * as THREE from "three";

const FAR = 1e6;
const NO_WALL = 1000; // a wall further out than this means there's none on that side
const SOFT = 0.25; // world units over which the press eases in at a wall

export class Mold {
  private readonly min = { value: new THREE.Vector2(-FAR, -FAR) };
  private readonly max = { value: new THREE.Vector2(FAR, FAR) };

  /** Hook a material's vertex shader up to the walls. */
  apply(material: THREE.Material): void {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMoldMin = this.min;
      shader.uniforms.uMoldMax = this.max;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
uniform vec2 uMoldMin;
uniform vec2 uMoldMax;
// Smooth max(v, wall): v well inside is untouched, v past the wall ends up on it.
// Sides without a wall (beyond NO_WALL) are left alone.
float moldAbove( float v, float wall ) {
  if ( wall < ${-NO_WALL}.0 ) return v;
  float d = v - wall;
  return wall + ( d + sqrt( d * d + ${SOFT * SOFT} ) ) * 0.5;
}`,
        )
        .replace(
          "#include <project_vertex>",
          `vec4 mvPosition = modelMatrix * vec4( transformed, 1.0 );
mvPosition.x = -moldAbove( -moldAbove( mvPosition.x, uMoldMin.x ), -uMoldMax.x );
mvPosition.y = -moldAbove( -moldAbove( mvPosition.y, uMoldMin.y ), -uMoldMax.y );
mvPosition = viewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
        );
    };
    material.needsUpdate = true;
  }

  /** Walls at these world coordinates; null for no wall on that side. */
  set(left: number | null, right: number | null, bottom: number | null, top: number | null): void {
    this.min.value.set(left ?? -FAR, bottom ?? -FAR);
    this.max.value.set(right ?? FAR, top ?? FAR);
  }

  clear(): void {
    this.set(null, null, null, null);
  }

  /** The walls as [minX, minY, maxX, maxY], to copy onto another Mold. */
  get walls(): [number, number, number, number] {
    return [this.min.value.x, this.min.value.y, this.max.value.x, this.max.value.y];
  }

  set walls([minX, minY, maxX, maxY]: [number, number, number, number]) {
    this.min.value.set(minX, minY);
    this.max.value.set(maxX, maxY);
  }
}

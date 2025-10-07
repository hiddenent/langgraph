"""Visualize a drone light show arrangement from a source image.

This script takes an input image, rescales it to the drone grid resolution
(58 columns by 46 rows), and generates a stylized visualization showing each
"drone" as a colored light.

Example:
    python examples/drone_light_show.py input.png --output drones.png

Requires the Pillow library (``pip install pillow``).

If no input image is provided the script will synthesize a demo gradient.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Tuple

from PIL import Image, ImageDraw

Resampling = getattr(Image, "Resampling", Image)


DRONE_COLUMNS = 58
DRONE_ROWS = 46
BACKGROUND_COLOR = (8, 13, 30)  # dark sky blue
DRONE_RADIUS = 9
DRONE_SPACING = 22


@dataclass(frozen=True)
class DroneGrid:
    """Data structure describing the drone layout."""

    rows: int
    columns: int
    colors: Tuple[Tuple[int, int, int], ...]

    @property
    def size(self) -> Tuple[int, int]:
        """Return the grid size as ``(width, height)``."""

        return (self.columns, self.rows)

    @classmethod
    def from_image(
        cls,
        image: Image.Image,
        *,
        rows: int = DRONE_ROWS,
        columns: int = DRONE_COLUMNS,
    ) -> "DroneGrid":
        """Create a :class:`DroneGrid` by sampling colors from ``image``."""

        resized = image.resize((columns, rows), resample=Resampling.LANCZOS)
        colors = tuple(resized.getdata())
        return cls(rows=rows, columns=columns, colors=colors)

    def iter_cells(self) -> Iterable[Tuple[int, int, Tuple[int, int, int]]]:
        """Yield (row, column, color) triples for each drone."""

        for index, color in enumerate(self.colors):
            row, column = divmod(index, self.columns)
            yield row, column, color


def load_input_image(path: Path | None) -> Image.Image:
    if path is None:
        return generate_demo_image()
    image = Image.open(path)
    return image.convert("RGB")


def generate_demo_image(width: int = 512, height: int = 512) -> Image.Image:
    """Create a simple demo gradient if no image is provided."""

    gradient = Image.new("RGB", (width, height))
    pixels = gradient.load()
    for x in range(width):
        for y in range(height):
            r = int(255 * x / width)
            g = int(255 * y / height)
            b = 128
            pixels[x, y] = (r, g, b)
    return gradient


def render_grid(grid: DroneGrid, *, output_path: Path | None = None) -> Path:
    """Render the grid to an image and return the path to the output."""

    width = (grid.columns - 1) * DRONE_SPACING + DRONE_RADIUS * 2 + DRONE_SPACING
    height = (grid.rows - 1) * DRONE_SPACING + DRONE_RADIUS * 2 + DRONE_SPACING
    canvas = Image.new("RGB", (width, height), color=BACKGROUND_COLOR)
    draw = ImageDraw.Draw(canvas)

    start_x = DRONE_SPACING
    start_y = DRONE_SPACING

    for row, column, color in grid.iter_cells():
        center_x = start_x + column * DRONE_SPACING
        center_y = start_y + row * DRONE_SPACING
        bounding_box = [
            (center_x - DRONE_RADIUS, center_y - DRONE_RADIUS),
            (center_x + DRONE_RADIUS, center_y + DRONE_RADIUS),
        ]
        draw.ellipse(bounding_box, fill=color)

    if output_path is None:
        output_path = Path("drone_light_show.png")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output_path)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "image",
        type=Path,
        nargs="?",
        help="Path to the source image. If omitted a demo gradient is used.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Destination path for the rendered drone layout image.",
    )
    parser.add_argument(
        "--rows",
        type=int,
        default=DRONE_ROWS,
        help="Number of drone rows (default: %(default)s).",
    )
    parser.add_argument(
        "--columns",
        type=int,
        default=DRONE_COLUMNS,
        help="Number of drone columns (default: %(default)s).",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    image = load_input_image(args.image)
    grid = DroneGrid.from_image(image, rows=args.rows, columns=args.columns)
    output_path = render_grid(grid, output_path=args.output)
    print(f"Rendered {grid.rows * grid.columns} drones to {output_path}")


if __name__ == "__main__":
    main()

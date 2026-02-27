"""
PUMP PLAYS REMASTER - ViGEm Virtual Controller Server
FastAPI server that creates virtual Xbox controllers via vgamepad.
Node.js sends HTTP requests, this server presses buttons on virtual controllers.

Usage:
    pip install -r requirements.txt
    python input_server.py

Project64/Dolphin sees the virtual controllers as real Xbox controllers.
"""

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from controller_manager import ControllerManager

manager = ControllerManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize controllers on startup, clean up on shutdown."""
    num_controllers = int(__import__("os").environ.get("NUM_CONTROLLERS", "1"))
    manager.init(num_controllers)
    print(f"[ViGEm] {num_controllers} virtual controller(s) ready")
    yield
    manager.cleanup()
    print("[ViGEm] Controllers released")


app = FastAPI(title="PUMP PLAYS ViGEm Server", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# === Request Models ===

class ButtonInput(BaseModel):
    controller: int = 0
    button: str  # XUSB_GAMEPAD_* constant name
    action: str = "press"  # "press" or "hold"
    duration_ms: int = 150


class AnalogInput(BaseModel):
    controller: int = 0
    stick: str = "left"  # "left" or "right"
    x: float = 0.0  # -1.0 to 1.0
    y: float = 0.0  # -1.0 to 1.0
    duration_ms: int = 200


class TriggerInput(BaseModel):
    controller: int = 0
    trigger: str = "left"  # "left" or "right"
    value: int = 255  # 0-255
    duration_ms: int = 150


# === Xbox button constant mapping ===
# Maps string names from Node.js to vgamepad button constants

BUTTON_MAP = {
    "XUSB_GAMEPAD_A": 0x1000,
    "XUSB_GAMEPAD_B": 0x2000,
    "XUSB_GAMEPAD_X": 0x4000,
    "XUSB_GAMEPAD_Y": 0x8000,
    "XUSB_GAMEPAD_DPAD_UP": 0x0001,
    "XUSB_GAMEPAD_DPAD_DOWN": 0x0002,
    "XUSB_GAMEPAD_DPAD_LEFT": 0x0004,
    "XUSB_GAMEPAD_DPAD_RIGHT": 0x0008,
    "XUSB_GAMEPAD_START": 0x0010,
    "XUSB_GAMEPAD_BACK": 0x0020,
    "XUSB_GAMEPAD_LEFT_THUMB": 0x0040,
    "XUSB_GAMEPAD_RIGHT_THUMB": 0x0080,
    "XUSB_GAMEPAD_LEFT_SHOULDER": 0x0100,
    "XUSB_GAMEPAD_RIGHT_SHOULDER": 0x0200,
}

# Trigger buttons handled separately (analog, not digital)
TRIGGER_MAP = {
    "XUSB_GAMEPAD_LEFT_TRIGGER": "left",
    "XUSB_GAMEPAD_RIGHT_TRIGGER": "right",
}


# === Routes ===

@app.get("/status")
async def status():
    return {
        "name": "PUMP PLAYS ViGEm Server",
        "controllers": manager.count(),
        "uptime_ms": int((time.time() - manager.start_time) * 1000),
    }


@app.post("/input")
async def button_input(inp: ButtonInput):
    """Press or hold a button on a virtual controller."""
    pad = manager.get(inp.controller)
    if not pad:
        return {"error": f"Controller {inp.controller} not found", "available": manager.count()}

    # Check if this is a trigger button (analog)
    if inp.button in TRIGGER_MAP:
        trigger_side = TRIGGER_MAP[inp.button]
        asyncio.create_task(_trigger_press(pad, trigger_side, 255, inp.duration_ms))
        return {"ok": True, "controller": inp.controller, "trigger": trigger_side}

    button_val = BUTTON_MAP.get(inp.button)
    if button_val is None:
        return {"error": f"Unknown button: {inp.button}", "available": list(BUTTON_MAP.keys())}

    # Fire and forget the press/hold in background
    asyncio.create_task(_button_press(pad, button_val, inp.duration_ms))
    return {"ok": True, "controller": inp.controller, "button": inp.button}


@app.post("/analog")
async def analog_input(inp: AnalogInput):
    """Move an analog stick on a virtual controller."""
    pad = manager.get(inp.controller)
    if not pad:
        return {"error": f"Controller {inp.controller} not found"}

    asyncio.create_task(_analog_move(pad, inp.stick, inp.x, inp.y, inp.duration_ms))
    return {"ok": True, "controller": inp.controller, "stick": inp.stick, "x": inp.x, "y": inp.y}


@app.post("/reset")
async def reset():
    """Release all buttons on all controllers."""
    manager.reset_all()
    return {"ok": True, "controllers_reset": manager.count()}


# === Background tasks for timed inputs ===

async def _button_press(pad, button_val, duration_ms):
    """Press a button, wait, then release."""
    pad.press_button(button_val)
    pad.update()
    await asyncio.sleep(duration_ms / 1000.0)
    pad.release_button(button_val)
    pad.update()


async def _analog_move(pad, stick, x, y, duration_ms):
    """Move stick to position, wait, then center."""
    # vgamepad takes values from -32768 to 32767
    ix = int(x * 32767)
    iy = int(y * 32767)

    if stick == "left":
        pad.left_joystick(ix, iy)
    else:
        pad.right_joystick(ix, iy)
    pad.update()

    await asyncio.sleep(duration_ms / 1000.0)

    # Return to center
    if stick == "left":
        pad.left_joystick(0, 0)
    else:
        pad.right_joystick(0, 0)
    pad.update()


async def _trigger_press(pad, side, value, duration_ms):
    """Press a trigger, wait, then release."""
    if side == "left":
        pad.left_trigger(value)
    else:
        pad.right_trigger(value)
    pad.update()

    await asyncio.sleep(duration_ms / 1000.0)

    if side == "left":
        pad.left_trigger(0)
    else:
        pad.right_trigger(0)
    pad.update()


if __name__ == "__main__":
    import uvicorn
    import os

    port = int(os.environ.get("VIGEM_PORT", "7777"))
    print(f"[ViGEm] Starting server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)

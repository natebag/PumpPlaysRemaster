"""
PUMP PLAYS REMASTER - Virtual Controller Manager
Manages multiple vgamepad virtual Xbox 360 controllers.
Supports up to 4 controllers for Pokemon Stadium 2 multiplayer.
"""

import time
import vgamepad as vg


class ControllerManager:
    def __init__(self):
        self.pads = []
        self.start_time = time.time()

    def init(self, num_controllers=1):
        """Create virtual Xbox 360 controllers."""
        num_controllers = max(1, min(num_controllers, 4))  # Clamp 1-4
        for i in range(num_controllers):
            pad = vg.VX360Gamepad()
            pad.update()
            self.pads.append(pad)
            print(f"[ViGEm] Controller {i + 1} created")

    def get(self, index=0):
        """Get a controller by index."""
        if 0 <= index < len(self.pads):
            return self.pads[index]
        return None

    def count(self):
        """Number of active controllers."""
        return len(self.pads)

    def reset_all(self):
        """Release all buttons on all controllers."""
        for pad in self.pads:
            pad.reset()
            pad.update()

    def cleanup(self):
        """Release all controllers."""
        for pad in self.pads:
            try:
                pad.reset()
                pad.update()
            except Exception:
                pass
        self.pads = []

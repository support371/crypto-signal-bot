import os

class ModeControl:
    def __init__(self, mode=None):
        self.mode = mode or self.load_mode_from_env()
        self.validate_mode()

    def load_mode_from_env(self):
        return os.getenv('APP_MODE', 'default')  # Load mode from environment variable, default to 'default'

    def validate_mode(self):
        valid_modes = ['development', 'production', 'testing', 'default']
        if self.mode not in valid_modes:
            raise ValueError(f"Invalid mode: {self.mode}. Must be one of {valid_modes}.")

    def get_mode(self):
        return self.mode

# Example usage:
# if __name__ == '__main__':
#     mode_control = ModeControl()
#     print(f'Current mode: {mode_control.get_mode()}')

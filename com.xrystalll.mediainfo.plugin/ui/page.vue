<template>
  <div style="padding: 12px; display: flex; flex-direction: column; gap: 14px;">
    <div style="display: flex; align-items: center; justify-content: space-between;">
      <label style="color: #e0e0e0; font-size: 13px;">{{ $t('Designer.Gradient') }}</label>
      <input
        type="checkbox"
        :checked="enableGradient"
        @change="onGradientToggle($event.target.checked)"
        style="width: 18px; height: 18px; accent-color: #FFF; cursor: pointer;"
      />
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between;">
      <label style="color: #e0e0e0; font-size: 13px;">{{ $t('Designer.BarColor') }}</label>
      <input
        type="color"
        :value="progressColor"
        @input="onColorChange('progressColor', $event.target.value)"
        @change="onColorChange('progressColor', $event.target.value)"
        style="width: 38px; height: 28px; border: none; background: transparent; cursor: pointer;"
      />
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between;">
      <label style="color: #e0e0e0; font-size: 13px;">{{ $t('Designer.BarBg') }}</label>
      <input
        type="color"
        :value="progressBgColor"
        @input="onColorChange('progressBgColor', $event.target.value)"
        @change="onColorChange('progressBgColor', $event.target.value)"
        style="width: 38px; height: 28px; border: none; background: transparent; cursor: pointer;"
      />
    </div>

    <button
      type="button"
      @click="resetColors"
      style="margin-top: 4px; padding: 6px 12px; background: #262626; color: #e0e0e0; border: 1px solid #3a3a3a; border-radius: 4px; font-size: 12px; cursor: pointer;"
    >
      {{ $t('Designer.ResetColors') }}
    </button>
  </div>
</template>

<script>
const DEFAULT_PROGRESS_COLOR = "#1DB954";
const DEFAULT_PROGRESS_BG_COLOR = "#000000";

export default {
  props: {
    modelValue: {
      type: Object,
      required: true
    }
  },
  data() {
    return {
      enableGradient: true,
      progressColor: DEFAULT_PROGRESS_COLOR,
      progressBgColor: DEFAULT_PROGRESS_BG_COLOR
    };
  },
  mounted() {
    if (!this.modelValue.data) {
      this.modelValue.data = {};
    }
    this.enableGradient = this.modelValue.data.enableGradient !== false;
    this.progressColor = this.modelValue.data.progressColor || DEFAULT_PROGRESS_COLOR;
    this.progressBgColor = this.modelValue.data.progressBgColor || DEFAULT_PROGRESS_BG_COLOR;
    this.syncSettings();
  },
  methods: {
    onGradientToggle(checked) {
      this.enableGradient = checked;
      if (!this.modelValue.data) {
        this.modelValue.data = {};
      }
      this.modelValue.data.enableGradient = checked;
      this.syncSettings();
    },
    onColorChange(field, value) {
      this[field] = value;
      if (!this.modelValue.data) {
        this.modelValue.data = {};
      }
      this.modelValue.data[field] = value;
      this.syncSettings();
    },
    resetColors() {
      this.progressColor = DEFAULT_PROGRESS_COLOR;
      this.progressBgColor = DEFAULT_PROGRESS_BG_COLOR;
      if (!this.modelValue.data) {
        this.modelValue.data = {};
      }
      this.modelValue.data.progressColor = DEFAULT_PROGRESS_COLOR;
      this.modelValue.data.progressBgColor = DEFAULT_PROGRESS_BG_COLOR;
      this.syncSettings();
    },
    syncSettings() {
      const payload = {
        type: "update-settings",
        enableGradient: this.enableGradient,
        progressColor: this.progressColor,
        progressBgColor: this.progressBgColor
      };

      if (this.$fd && typeof this.$fd.sendToBackend === "function") {
        this.$fd.sendToBackend(payload);
      }
    }
  }
};
</script>

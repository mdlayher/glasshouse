# Remote Button Events

Capture presses of the four colored buttons (**Red**, **Green**, **Yellow**, and **Blue**) on your LG Magic Remote or IR remote to trigger automations in Home Assistant.

---

## Overview

Most LG remotes include dedicated colored buttons (traditionally used for teletext or HbbTV interactive services). This feature listens directly to input events from the remote control on webOS and publishes each press to Home Assistant as an [Event entity](https://www.home-assistant.io/integrations/event/).

Because it is exposed as an `event` entity rather than a `sensor`, every press fires an event in Home Assistant—even if you press the same button multiple times in succession.

---

## How to Turn It On

This feature is **experimental** and turned off by default.

### From the Dashboard

1. Open the dashboard in your browser.
2. Go to the **Server** tab (`/?tab=server`).
3. Scroll down to **Experimental features**.
4. Toggle **Remote button events** to **On**.

Home Assistant will automatically discover the `event.lg_tv_remote_button` entity within seconds.

### From `config.json`

Add `"allowRemoteButtons": true` to your `config.json`:

```json
{
  "allowRemoteButtons": true
}
```

Then restart the server or re-run `./deploy.sh <tv-ip>`.

---

## Home Assistant Entity

| Entity | Type | Event Types | Topic |
|---|---|---|---|
| `event.lg_tv_remote_button` | `event` | `red`, `green`, `yellow`, `blue` | `lgtv/events/button` |

When a button is pressed, the server publishes a JSON payload to the event topic:

```json
{
  "event_type": "red",
  "button": "red"
}
```

---

## Setting Up Automations

### Using the Home Assistant Automation UI

1. Go to **Settings** → **Automations & Scenes** → **Create Automation**.
2. Under **When** (Triggers), choose **Entity** → **State**.
3. Select entity **Remote Button** (`event.lg_tv_remote_button`).
4. In the **Event type** field, enter the color: `red`, `green`, `yellow`, or `blue`.
5. Under **Then do** (Actions), add any action you want (e.g. toggle lights, run a script, set a scene).

---

### YAML Examples

#### Example 1: Toggle Living Room Lights with the Red Button

```yaml
alias: "TV Remote: Red button toggles living room lights"
description: "Toggle living room lights when the red button is pressed on the TV remote"
trigger:
  - platform: state
    entity_id: event.lg_tv_remote_button
    attribute: event_type
    to: "red"
action:
  - action: light.toggle
    target:
      entity_id: light.living_room
mode: single
```

#### Example 2: Cinema Mode with the Blue Button

```yaml
alias: "TV Remote: Blue button activates cinema mode"
description: "Dim lights and set cinema scene"
trigger:
  - platform: state
    entity_id: event.lg_tv_remote_button
    attribute: event_type
    to: "blue"
action:
  - action: scene.turn_on
    target:
      entity_id: scene.movie_night
mode: single
```

#### Example 3: Handling All Four Buttons in a Single Automation

You can handle all four colored buttons within a single automation using a `choose` action:

```yaml
alias: "TV Remote: Colored button actions"
description: "Actions for red, green, yellow, and blue remote buttons"
trigger:
  - platform: state
    entity_id: event.lg_tv_remote_button
action:
  - choose:
      # Red Button
      - conditions:
          - condition: template
            value_template: "{{ trigger.to_state.attributes.event_type == 'red' }}"
        sequence:
          - action: light.toggle
            target:
              entity_id: light.living_room

      # Green Button
      - conditions:
          - condition: template
            value_template: "{{ trigger.to_state.attributes.event_type == 'green' }}"
        sequence:
          - action: cover.toggle
            target:
              entity_id: cover.living_room_blinds

      # Yellow Button
      - conditions:
          - condition: template
            value_template: "{{ trigger.to_state.attributes.event_type == 'yellow' }}"
        sequence:
          - action: climate.set_preset_mode
            target:
              entity_id: climate.living_room
            data:
              preset_mode: "comfort"

      # Blue Button
      - conditions:
          - condition: template
            value_template: "{{ trigger.to_state.attributes.event_type == 'blue' }}"
        sequence:
          - action: scene.turn_on
            target:
              entity_id: scene.movie_night
mode: queued
```

---

## Technical Details

- **Input Devices**: webOS exposes remote input streams via `/dev/input/event*` devices (`LGE RCU` for infrared, `LGE M-RCU` for Bluetooth Magic Remotes).
- **Non-Invasive**: The listener reads the Linux kernel input stream passively without injecting binaries or intercepting system processes.
- **Debouncing**: Hardware keypresses across duplicate event devices are automatically debounced within 200 ms to prevent double-triggering.
- **State Cleanup**: When the feature is disabled, the Home Assistant discovery payload is automatically withdrawn so unused entities do not clutter your setup.

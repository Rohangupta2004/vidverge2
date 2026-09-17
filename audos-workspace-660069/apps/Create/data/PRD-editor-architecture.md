# Product Track PRD — Editor Architecture (v1.1)

## 18. Editor Architecture

### 18.1 Two editing surfaces, two audiences

The Product track uses separate editing surfaces for internal and customer-facing use.

**Internal / advanced editing — `@hyperframes/studio`**

Studio is the full composition environment for internal operators, implementation work, debugging, and agent-assisted editing.

It may expose:

* Source/code editing
* Visual timeline
* Visual keyframe editing
* Scene selection and playhead control
* Motion authoring
* Detailed style manipulation
* Frame inspection
* Agent-assisted edits
* Undo/redo
* Live preview

Studio must not be exposed as the default customer editor.

> **The editor is not a video editor in the traditional sense. It is a controlled interface for mutating an editable HyperFrames composition.**

**Customer editing — Product Editor**

The customer-facing product provides a deliberately narrow editing UI over the HyperFrames project.

V1 exposes:

* Text
* Timing
* Music
* Colour

Scene regeneration is NOT in V1.

Customers must not need to understand or edit HTML, CSS, JavaScript, or composition source.

**Playback / preview — `@hyperframes/player`**

The customer-facing preview uses `@hyperframes/player`.

The Product Editor wraps the Player rather than implementing a second playback engine.

---

### 18.2 Single source of truth

There must be one authoritative HyperFrames project representation.

Studio, the Product Editor, the agent, and the Player must not maintain independent composition models.

```
                    HYPERFRAMES PROJECT
                           |
             +-------------+-------------+
             |             |             |
           Studio      Product Editor   Agent
             |             |             |
             +-------------+-------------+
                           |
                    @hyperframes/player
                           |
                         Render
```

The Product Editor is a controlled mutation layer, not a second composition engine.

---

## 19. Safe Editing Contract

| Property         | Customer | Agent | Constraint                    |
| ---------------- | -------: | ----: | ----------------------------- |
| Headline         |      Yes |   Yes | Text only                     |
| Caption          |      Yes |   Yes | Text only                     |
| Scene duration   |      Yes |   Yes | Within validated route limits |
| Music track      |      Yes |   Yes | Approved/frozen asset only    |
| Music volume     |      Yes |   Yes | Valid range                   |
| Brand colours    |      Yes |   Yes | Brand-token based             |
| Layout structure |       No |   Yes | Plan-controlled               |
| Motion system    |       No |   Yes | Plan-controlled               |
| Asset source     |       No |   Yes | Manifest-controlled           |
| Composition code |       No |   Yes | Internal/Studio only          |

Unsupported mutations must be rejected explicitly. They must never silently alter the composition.

---

## 20. Project Ownership and Versioning

### 20.1 Field ownership

* `PLANNER` — structural creative intent
* `BUILDER` — implementation details
* `USER` — customer-controlled values
* `SYSTEM` — generated/runtime metadata

### 20.2 Version identity

Project must maintain at minimum:

```
project.version
project.schema_version
project.updated_at
project.last_render_version
```

Each render must record: project, schema, asset manifest, composition, audio, voice versions.

---

## 21. Live Synchronization

A successful edit must propagate across:

1. Saved project state
2. Composition source
3. Preview
4. Timeline/playhead
5. Scene thumbnails
6. Player state
7. Undo history

A partial update is a failure. The UI must never show a preview representing a different project state from the saved editable source.

**Autosave:** Edits are written continuously via debounced autosave on every change, not on submit. A save failure becomes a background retry — the user is never interrupted and keeps editing uninterrupted.

**Preview lag:** If the preview has not refreshed within a reasonable bound after an edit, show a spinner on the preview panel only. Edit controls remain live.

---

## 22. Undo, Redo, and Agent Collaboration

### 22.1 Undo/redo

* Undo
* Redo
* Failed mutations create no persistent state
* Compatible rapid edits may be coalesced
* Every render references the project version that produced it

### 22.2 Human + agent collaboration

The human and agent operate against the same project state.

**Conflict resolution:** The user's value always wins. If the agent fires a mutation while the user is editing the same field, the agent's write is discarded for that field and the agent's intent is logged in the activity feed. No dialog, no two-button prompt — the user's edit is never interrupted.

Agent edits must remain undoable.

---

## 23. Scene-Level Regeneration Contract

`Regenerate Scene` is internal/agent only in V1 — not exposed in customer UI.

The system must:

1. Preserve unrelated scenes
2. Preserve the global brand kit
3. Preserve voice identity
4. Preserve unrelated audio constraints
5. Reuse existing assets where appropriate
6. Regenerate only the selected scene
7. Validate the affected scene
8. Re-run whole-film validation before final delivery

A local regeneration must not silently redesign the entire film.

---

## 24. Scene Editability States

```
EDITABLE
BAKED
REGENERATING
ERROR
LOCKED
```

Track B Product scenes are normally `EDITABLE`. Track A footage is normally `BAKED`. An agent may not unlock Track A footage — that state is prohibited for customer-side writes.

The UI must explain why an action is unavailable rather than presenting an unexplained disabled control.

---

## 25. Data Contract Extension

Each editable field should identify: stable field identifier, scene identifier, current value, allowed value/range, owner, whether customer may edit it, whether agent may edit it, validation rule.

The schema must be versioned.

---

## 26. Editor Definition of Done

1. Every promised customer control works
2. Unsupported properties cannot be accidentally modified
3. Successful edits update source and preview consistently
4. Undo restores the previous project state
5. Redo reapplies the intended mutation
6. Scene regeneration does not modify unrelated scenes
7. Agent edits are visible and undoable
8. Customers never need CodeMirror or source-code access
9. Editable and baked scenes are visibly distinguishable
10. Every render can be traced to an exact project version
11. Failed mutations leave the previous valid state intact
12. The Product Editor does not introduce a second rendering/composition engine

---

## 27. Implementation Guardrails

* No customer CodeMirror
* No second composition engine
* No independent customer-side project model
* No silent global regeneration from a local edit
* No hidden agent mutations
* No loss of project version identity after rendering
* No customer mutation of planner-controlled structural fields
* No assumption that Track A footage has the same editability as Track B

---

## 28. Open Items

1. Orchestrator name and integration boundary
2. Surrounding application stack
3. Exact `@hyperframes/studio` integration surface
4. Exact `@hyperframes/player` integration surface
5. Customer editor UI implementation
6. Safe mutation API/schema
7. Project persistence mechanism
8. Undo/redo persistence strategy
9. Human/agent conflict handling
10. Music provider
11. Additional asset provider
12. Existing Track A bugs in their separate specification

None of these open items may justify modifying the existing Track A pipeline.

---

## 29. Final Architecture Decision

```
USER
 |
 v
CUSTOM PRODUCT EDITOR
 |  Text / Timing / Music / Colour
 |
 v
HYPERFRAMES PROJECT  <------ AGENT
 |                         intent + controlled mutations
 |
 +-----------> STUDIO
 |              internal / advanced editing
 |
 v
@hyperframes/player
 |
 v
PREVIEW / RENDER
```

Studio is the internal full editor. Player is the playback/rendering surface. The custom Product Editor is the customer-facing control layer. The HyperFrames project is the shared source of truth. No surface should become a competing composition engine.

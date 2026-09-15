# Update a Cursor Segment

Cursor updates target a persisted `cursor` Segment by `segment_id`.

Retrieve and follow `editing_cursors` before updating a `cursor` Segment.

Example workflow: read current cursor properties, then send only schema-approved behavior or appearance fields that need changing.

- The `properties` patch must be non-empty.

## Exact input type

```ts
type Input={timeline_hash:string;tx_id:string;updates:{properties:{click_effect?:{color:{a:number;b:number;g:number;r:number};kind:"circle"|"ring";radius:number}|null;click_sound?:"click1"|"click2"|null;click_sound_volume?:number|null;following_mode?:"auto"|"minimal"|"medium"|"tight"|null;hide_camera_on_overlap?:boolean|null;hide_when_still?:boolean|null;highlight?:{color:{a:number;b:number;g:number;r:number};radius:number}|null;size_factor?:number|null;style?:{kind:"mac"}|{kind:"mac_tahoe"}|{kind:"windows"}|{kind:"windows_vintage"}|{kind:"pointer";primary_color:{a:number;b:number;g:number;r:number};secondary_color:{a:number;b:number;g:number;r:number};stroke_width:number}|{arm_kind:"arrow"|"bodybuilder_masculine_deep"|"bodybuilder_masculine_light"|"bodybuilder_masculine_medium"|"candy_cane"|"cartoon"|"cat_orange_tabby"|"conductor_baton"|"crystal_staff"|"dog_golden"|"drumstick"|"felt_tv_puppet"|"human_feminine_deep"|"human_feminine_light"|"human_feminine_medium"|"human_masculine_deep"|"human_masculine_light"|"human_masculine_medium"|"laser_blue"|"magic_wand_classic"|"magic_wand"|"matchstick"|"paintbrush"|"pencil"|"pool_cue"|"presentation_pointer"|"robot_chrome"|"santa_glove"|"skeleton_bone"|"stick_hand_black_black"|"stick_hand_white_chrome"|"wooden_mannequin";kind:"arm"}|null};segment_id:string;type:"cursor"}[]};
```

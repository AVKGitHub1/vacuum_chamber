# Catalog dimensions and evidence

Reviewed on 2026-10-01. All dimensions in `data/catalog.json` are millimeters; angular limits are degrees. The user's later clarification limits this application to CF and ISO-F interfaces. The supplied screenshots remain the evidence for the body diameter choices, labels, parameter definitions, 36-inch height limit, and CF style choices. A hidden dropdown or server-side validation rule is not treated as verified.

## How to interpret verification

`verifiedFields` identifies individual numbers supported by the cited vendor tables, including unit conversions. `provisionalFields` identifies assumptions that still need the selected component's dimensioned drawing. `verified: false` means the complete modeled profile has not been verified; it does not mean its flange OD or bolt pattern was guessed. These dimensions support layout work but do not constitute a manufacturing drawing.

The catalog deliberately distinguishes a flange's clear `bore`, its rear tube socket `counterBore`, and `tubeOD - 2 * tubeWall`. They are not generally identical. `setback` is the vendor's tabulated dimension and is retained as metadata until a section drawing establishes the datum. Do not infer a chamber wall thickness from a flange bore or use `setback` as an assumed socket depth.

## CF port dimensions

The [Lesker fixed-bored 304L CF flange table](https://www.lesker.com/newweb/flanges/flanges_cf_304ss.cfm?pgid=fixedbored) supplies each selected part's flange OD, nominal tube OD, clear bore, socket diameter, thickness, bolt circle, clearance-hole diameter, hole count, and setback. `partNumber` records the selected bored part. Values are converted from the inch table using exactly 25.4 mm/inch. For fractional names such as 2-1/8 and 4-5/8, the exact fraction is used rather than the rounded 2.13/4.63 display label.

The [Lesker fixed tapped-bored table](https://www.lesker.com/newweb/flanges/flanges_cf_304ss.cfm?pgid=fixedtappedbored) supplies the imperial thread selections. The catalog converts nominal major diameter and pitch into millimeters. A nominal thread diameter is not the tap-drill diameter. A threaded-hole feature must use the stated thread designation rather than cutting a nominal-major-diameter clearance hole.

The [MBE-Komponenten flange-dimension table](https://www.mbe-komponenten.de/service/flange-gasket/) supplies the CF knife circle and seal-recess diameter, citing ISO 3669:2020. It supplies a standard interface description, not a detailed Lesker manufacturing profile. The catalog therefore combines a named Lesker outer/bolt/bore profile with that standard sealing-circle reference, and identifies the latter separately with `sealSource`.

The screenshot's DN150CF name is retained; Lesker calls the same 8-inch flange DN160CF. The screenshot's DN273CF name is also retained; the 13.25-inch Lesker catalog item is DN275CF. These label aliases do not alter the selected outer diameter.

The simplified CF sealing section uses `sealInner = bore`, a recessed face ending at `sealOuter`, and an annular knife at `knifeEdgeDiameter`. The current depth (1.2 mm), tip setback (0.6 mm), and ridge half-width (0.5 mm) are explicit editable assumptions. The source does not dimension this entire section. In particular, it does not establish the exact Lesker knife radius, inner/outer taper, relief, or tolerance. A triangular ridge is a visual approximation until a chosen manufacturing profile is supplied.

[Lesker's CF overview](https://www.lesker.com/vacuum-flanges-components.cfm?section=304l-ss-standard-cf-flanges) describes rotatable flanges as an inner weld ring and outer bolt ring. The cited fixed-flange tables do not supply their retainer/insert shoulder dimensions. Any modeled rotatable shoulder is provisional and must remain identified as such. The four style choices reproduce the screenshots, not an assertion that every catalog size is stocked in every style.

## ISO-F port and chamber-end dimensions

The [Lesker ISO technical-notes table](https://www.lesker.com/newweb/flanges/flanges_technicalnotes_iso_1.cfm), Table 3, supplies nominal ISO-F OD, thickness, bolt circle, clearance-hole diameter/count, and corresponding tube OD for DN63 through DN630. These are nominal table dimensions; a selected individual product can have small differences. For example, the [Lesker DN320 product table](https://www.lesker.com/newweb/flanges/flanges_iso_f.cfm?pgid=iso320) gives 424.942 mm OD, 20.066 mm thickness, 394.970 mm bolt circle, and 14.3002 mm holes, while the nominal table gives 425/20.07/395/14 mm. The initial catalog consistently uses the nominal interface table for those fields.

Bore and rear socket dimensions are selected from the [Lesker DN320 table](https://www.lesker.com/newweb/flanges/flanges_iso_f.cfm?pgid=iso320), [Lesker DN400 table](https://www.lesker.com/newweb/flanges/flanges_iso_f.cfm?pgid=iso400), and the [AdvanTorr manufacturer catalog](https://www.kl-advantorr.com/_i/assets/file/download/5820435c61b2dc9999369a699db7961e.pdf), printed page 147 (PDF page index 81), for the remaining sizes. `boreSource` records this explicitly. These profiles combine a nominal ISO-F interface with a selected vendor bore; they are not asserted to reproduce every detail of a particular Lesker part.

The ISO face receives a centering-ring/O-ring assembly. A centering-ring dimension is not automatically a groove dimension. `centeringRecessDiameter` retains the available reference value. Recess depth is not established by the accessed drawings. Depths of 2 mm (smaller sizes) and 3 mm (DN320 upward) are provisional. Where the published recess diameter is equal to or smaller than the selected bore, an explicit placeholder annular groove is used instead of inventing a supposedly standard counterbore. Such a groove must be called out as provisional in the UI/export and replaced with the actual chosen face section before manufacturing.

`endProfiles` contains ISO-F nominal interfaces for the four body sizes with direct nominal tube matches: 323.85, 406.4, 508, and 609.6 mm. Their clear bores remain flange dimensions, independent of the chamber wall. No standard-match claim is made for the 762 or 914.4 mm chamber bodies.

Two CF end profiles use MBE's standard DN350CF and DN400CF interfaces with custom bores for the 323.85 and 406.4 mm bodies, respectively. Their outside diameter, bolt pattern, thickness, knife diameter, and recess diameter come from that vendor table. Their bore is an explicit custom choice (body OD minus twice the editable default 3.175 mm wall), rather than a claim that the vendor supplies that exact bored chamber ring. The remaining four body sizes require separately specified CF end interfaces. CF end profiles have clearance holes; the optional nominal thread metadata remains an unverified engineering assumption.

## Remaining design assumptions

The screenshot/configuration data does not establish chamber wall thickness, weld land/preparation, weld beads, material finish, pressure qualification, exact ring shoulders, or end closure construction. The 3.175 mm chamber-wall default and the port-tube wall defaults are editable engineering assumptions. They are not presented as a universal vacuum-vessel standard or as verified Lesker Chamber Builder output.

The screenshots establish alpha zero on the positive X axis and beta zero along the vertical chamber axis, with beta 90 degrees radial. The detailed beta diagram labels 45–135 degrees. One broader diagram labels 0–180 degrees; the implementation uses the more specific 45–135 diagram as the permitted range and records this ambiguity rather than claiming to have recovered Lesker's hidden logic.

# Running the Fusion export

Export **Fusion Python** from the chamber builder. The downloaded file contains
the resolved dimensions and generation code; it does not need this project,
NumPy, Manifold, the local server, or an internet connection inside Fusion.

1. Open the destination design in Autodesk Fusion's **Design** workspace.
2. Ensure **Capture Design History** is enabled. The script stops before adding
   geometry if the design uses direct modeling.
3. Open **Utilities → Scripts and Add-Ins** and create a new **Python script**
   named `Chamber`. Open its folder and replace `Chamber.py` with the downloaded
   file, retaining the filename `Chamber.py`. Alternatively, paste the downloaded
   file's complete contents into the generated Python file.
4. Select the script and click **Run**. It creates a new component in the active
   design and groups its timeline features. Existing components remain present.
   On Fusion versions with a Part/Assembly/Hybrid design-intent setting, a Part
   design becomes Hybrid so that it can contain the new chamber component.
5. Read the completion notes. An unsuccessful operation labels the partial
   component **INCOMPLETE chamber - inspect error** and reports the operation and
   traceback. Delete that partial component before retrying.

The generated file uses Autodesk's documented `run(context)` script entry point.
See [Autodesk's script instructions](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/WritingDebugging_UM.htm).

## Geometry and coordinates

The chamber is vertical along **Z**. Its bottom outer flange face is at `Z=0`
and its top outer flange face is at `Z=Height`. Both end flanges are **open rings**;
cover plates, gaskets, bolts, equipment, and mounting supports are not supplied.

Each port's focal point is `(0, 0, elevation)`. Alpha runs counterclockwise from
`+X`, and beta is the polar angle measured from `+Z` (90° is horizontal). Focal
length runs from that focal point to the port's **outer flange face**. The flange
thickness extends back toward the chamber. Tubes are trimmed to the chamber's
inner cylindrical wall, and the shell receives matching tube-OD openings.

The result includes the shell, open end rings, port tubes and flanges, flange
bolt patterns, and face sealing features. Rotatable CF selections create a
separate bolt ring and stepped insert. These are bodies inside the new chamber
component rather than a mechanical joint assembly. Tapped styles attempt native
cosmetic thread features using the requested installed Fusion thread designation.
If no exact designation or compatible face is found, the completion dialog
explicitly reports that nominal-diameter holes remain without thread features.

## Editing the result

Use **Modify → Change Parameters**. Parameters are prefixed `VC1_`, `VC2_`, and
so on to avoid collisions with earlier chamber exports. Length parameters use
millimetres and angle parameters use degrees, regardless of the GUI display units.
These parameters drive actual sketch dimensions, offset and angle planes,
extrusions, sealing-profile lofts, and hole-pattern counts.

The flange bore is a separate dimension from the chamber ID. Standard end bore
dimensions remain independent when the chamber wall thickness changes. Port tube
ID follows tube OD minus twice the tube wall; a flange bore can differ from that ID.

Changing a flange family, fixed/rotatable construction, or thread designation
changes topology or a library selection. Choose the new option in the GUI and
export again for those changes. Increasing a tapped pattern's count manually may
require assigning cosmetic threads to the additional holes. Parameter edits can
also create physical collisions or impossible geometry; rerun the GUI collision
check for the changed configuration. Fusion parameter edits are not sent back to
the GUI automatically.

## Dimensional limits and verification

Published outer flange dimensions, bolt circles and hole counts are sourced in
the catalog. Some seal-section dimensions and tube walls are editable assumptions.
The exported component saves the full configuration, sources, notes, and warnings
as attributes under `VacuumChamberBuilder`.

CF faces include a recessed tapered annular knife edge. Its root width, depth,
tip setback, and 0.04 mm tip flat are provisional CAD dimensions. ISO-F recesses
also contain provisional dimensions where complete supplier section drawings
were unavailable. Rotatable insert and retaining-shoulder dimensions are explicit
approximations. These details are not certified manufacturing profiles.

Weld sockets, catalog counterbores with an unverified depth datum, edge chamfers,
and weld beads are not modeled. The tube ends at the flange's rear face. Consult
the selected manufacturer's section drawing before preparing fabrication drawings.

The exporter has automated checks for valid embedded geometry data, standalone
Python syntax, all catalog flange choices, preservation of overrides, and design
history protection. **The generated CAD operations have not been executed in
Autodesk Fusion in this development environment.** Before relying on a design:

1. Generate a single horizontal CF port and an ISO-F port in a blank parametric
   design; inspect the openings, front-face locations, and sealing sections.
2. Change alpha, beta, elevation, focal length, body height, wall thickness, and
   a flange diameter. Confirm the model recomputes and the intended feature moves.
3. Inspect a rotatable CF selection and a tapped selection, including the
   completion notes and the native thread feature.
4. Re-run the same export in a design with an existing component and verify the
   original timeline and geometry remain intact.

Relevant Autodesk references:

- [Parametric offset planes](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ConstructionPlaneInput_setByOffset.htm)
- [Parametric angle planes](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ConstructionPlaneInput_setByAngle.htm)
- [Driving sketch dimensions](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_SketchDimensions_addDistanceDimension.htm)
- [Restricting cut participant bodies](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ExtrudeFeatureInput_participantBodies.htm)
- [Native thread definitions](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_ThreadInfo_create.htm)
- [Design history mode](https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/fusion_Design_designType.htm)

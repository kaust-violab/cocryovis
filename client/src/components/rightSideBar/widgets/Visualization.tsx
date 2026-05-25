import {
  makeStyles,
  tokens,
  Field,
  Radio,
  RadioGroup,
  Button,
  Slider,
  Tooltip,
  Switch,
  Text,
  mergeClasses,
} from "@fluentui/react-components";
import {
  ArrowCircleRight28Regular,
  EditFilled,
  EraserFilled,
} from "@fluentui/react-icons";
import { useState } from "react";
import * as Utils from "@/utils/helpers";
import globalStyles from "../../globalStyles";
import { observer } from "mobx-react-lite";
import { useMst } from "@/stores/RootStore";
import { WriteAccessTooltipContentWrapper } from "../../shared/WriteAccessTooltip";
import type { VolVisSettingsInstance } from "@/stores/uiState/VolVisSettings";
import ShortcutKey from "../../shared/ShortcutKey";
import {
  createFromFiles,
  updateAnnotations,
  updateVolumeData,
} from "@/api/volumeData";
import ToastContainer from "@/utils/toastContainer";
import type { ClippingPlaneType } from "@/renderer/volume/clippingPlaneManager";
import { clippingPlaneOptions } from "@/stores/uiState/VisualizedVolume";

const useStyles = makeStyles({
  uploadSection: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  Button: {
    "&:hover:enabled": {
      backgroundColor: "#ddff77",
      color: "black",
    },
  },
  transferFunctions: {
    display: "flex",
    alignItems: "flex-start",
    gap: "5px",
  },
  sliderContainer: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
  },
  colorPicker: {
    marginTop: "0px",
    width: "40px",
    height: "43px",
    border: "none",
    cursor: "pointer",
    background: "none",
    marginRight: "5px",
    padding: 0,
  },
  actionButton: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    borderRadius: "5px",
    marginTop: "2px",
    ":hover": {
      cursor: "pointer",
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  clippingPlane: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  volumes: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "auto auto auto",
    alignItems: "center",
  },
  volumesRow: {
    display: "contents",
  },
  volumesHeader: {
    marginBottom: "8px",
  },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "180px 1fr",
    alignItems: "center",
  },
  settingsGridRow: {
    display: "contents",
  },
  tfIcon: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    paddingTop: "8px",
    paddingBottom: "8px",
    paddingRight: "8px",
    paddingLeft: "8px",
    borderRadius: "10px",
    ":hover": {
      cursor: "pointer",
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  DrawEraseButton: {},
  DrawEraseButtonToggled: {
    backgroundColor: tokens.colorNeutralBackground1Pressed,
    color: tokens.colorBrandForeground1,
    pointerEvents: "none",
  },
});

interface Props {
  open: boolean;
  close: () => void;
}

const Visualization = observer(({ open, close }: Props) => {
  const { user, uiState, renderer } = useMst();

  const classes = useStyles();
  const globalClasses = globalStyles();

  const [processingSaveAnnotations, setProcessingSaveAnnotations] =
    useState(false);

  const handleSaveAnnotations = async () => {
    if (
      annotationsActionsDisabled() ||
      uiState.visualizedVolume?.volume === undefined
    ) {
      return;
    }

    const toastContainer = new ToastContainer();
    try {
      toastContainer.loading("Saving annotations...");
      if (!renderer) {
        throw new Error("Renderer not initialized!");
      }
      if (!uiState.visualizedVolume.canEditLabels) {
        throw new Error("Only raw volumes can be labeled.");
      }

      setProcessingSaveAnnotations(true);
      const annotationData = await renderer.annotationManager.exportAnnotation(
        uiState.visualizedVolume.manualLabelIndex
      );

      if (!annotationData) {
        throw new Error("No annotations to save.");
      }

      if (
        uiState.visualizedVolume.manualLabelIndex >=
        uiState.visualizedVolume.volume.sparseVolumeArray.length
      ) {
        // let sparseLabel = await addAnnotations(volume.id, annotationData);
        if (!uiState.visualizedVolume.volume.rawData) {
          throw new Error("Volume missing raw data.");
        }
        const filename = `volume-channel-${uiState.visualizedVolume.manualLabelIndex}.raw`;
        let sparseLabel = await createFromFiles(
          "SparseLabeledVolumeData",
          uiState.visualizedVolume.volume.id,
          {
            rawFile: new File([annotationData], filename, {
              type: "application/octet-stream",
            }),
            volumeSettings: {
              file: filename,
              size: {
                x: uiState.visualizedVolume.volume.rawData.sizeX,
                y: uiState.visualizedVolume.volume.rawData.sizeY,
                z: uiState.visualizedVolume.volume.rawData.sizeZ,
              },
              bytesPerVoxel: 1,
              usedBits: 8,
              isLittleEndian: true,
            },
          }
        );

        sparseLabel = await updateVolumeData(
          "SparseLabeledVolumeData",
          sparseLabel.id,
          {
            color:
              uiState.visualizedVolume.volume.sparseLabelColors[
                uiState.visualizedVolume.manualLabelIndex
              ],
          }
        );

        uiState.visualizedVolume.volume.addSparseVolume(sparseLabel);
      } else {
        const sparseLabelVolume =
          uiState.visualizedVolume.volume.sparseVolumeArray[
            uiState.visualizedVolume.manualLabelIndex
          ];

        const rawFile = new File(
          [annotationData],
          `volume-channel-${uiState.visualizedVolume.manualLabelIndex}.raw`,
          {
            type: "application/octet-stream",
          }
        );

        await updateAnnotations(
          uiState.visualizedVolume.volume.id,
          sparseLabelVolume.id,
          {
            rawFile: rawFile,
          }
        );
      }
      toastContainer.success("Annotations saved.");
    } catch (error) {
      toastContainer.error(Utils.getErrorMessage(error));
      console.error("Error:", error);
    } finally {
      setProcessingSaveAnnotations(false);
    }
  };

  const handleClearAnnotations = () => {
    if (annotationsActionsDisabled()) {
      return;
    }

    uiState.visualizedVolume?.clearActiveAnnotationChannel();
  };

  const actionsDisabled = () => {
    return !uiState.visualizedVolume;
  };

  const annotationsActionsDisabled = () => {
    return (
      actionsDisabled() ||
      processingSaveAnnotations ||
      !uiState.visualizedVolume?.canEditLabels ||
      !uiState.visualizedVolume.labelEditingMode
    );
  };

  return (
    <div
      className={mergeClasses(
        globalClasses.rightSidebar,
        !open && globalClasses.invisible
      )}
      aria-hidden={!open}
    >
      <div className={globalClasses.sidebarContents}>
        <div className={globalClasses.sidebarHeader}>
          <h1>Visualization</h1>
          <div
            onClick={close}
            className={globalClasses.closeSidebarIconContainer}
          >
            <ArrowCircleRight28Regular
              className={globalClasses.closeSidebarIcon}
            />
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            justifyItems: "center",
            width: "100%",
            margin: "auto",
            paddingTop: "4px",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-around",
            }}
          >
            <Tooltip
              content={
                <WriteAccessTooltipContentWrapper
                  content={
                    uiState.visualizedVolume?.manualLabelIndex
                      ? `Saves annotations into Manual Label ${uiState.visualizedVolume.manualLabelIndex}.`
                      : "Saves annotations into selected manual label."
                  }
                  hasWriteAccess={
                    annotationsActionsDisabled() ||
                    user.userProjects.activeProject?.hasWriteAccess
                  }
                />
              }
              relationship={"label"}
            >
              <Button
                onClick={() => void handleSaveAnnotations()}
                className={classes.Button}
                disabled={
                  annotationsActionsDisabled() ||
                  !user.userProjects.activeProject?.hasWriteAccess
                }
              >
                Save Annotation
              </Button>
            </Tooltip>

            <Button
              onClick={handleClearAnnotations}
              className={classes.Button}
              disabled={annotationsActionsDisabled()}
            >
              Clear Annotation
            </Button>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Field label="Annotation Mode">
              <div
                style={{
                  display: "flex",
                  flexDirection: "row",
                  width: "80px",
                  justifyContent: "space-between",
                  marginTop: "5px",
                  marginLeft: "14px",
                }}
              >
                <Tooltip
                  content={
                    <Text>
                      Draw Annotations <ShortcutKey content="L" />
                    </Text>
                  }
                  relationship={"label"}
                  positioning="before"
                  appearance="inverted"
                >
                  <Button
                    className={mergeClasses(
                      classes.DrawEraseButton,
                      uiState.visualizedVolume &&
                        !uiState.visualizedVolume.eraseMode &&
                        classes.DrawEraseButtonToggled
                    )}
                    disabled={annotationsActionsDisabled()}
                    icon={<EditFilled />}
                    appearance="outline"
                    onClick={() => {
                      uiState.visualizedVolume?.setEraseMode(false);
                    }}
                  />
                </Tooltip>
                <Tooltip
                  content={
                    <Text>
                      Erase Annotations <ShortcutKey content="L" />
                    </Text>
                  }
                  relationship="label"
                  positioning="after"
                  appearance="inverted"
                >
                  <Button
                    disabled={annotationsActionsDisabled()}
                    className={mergeClasses(
                      classes.DrawEraseButton,
                      uiState.visualizedVolume &&
                        uiState.visualizedVolume.eraseMode &&
                        classes.DrawEraseButtonToggled
                    )}
                    icon={<EraserFilled />}
                    appearance="outline"
                    onClick={() => {
                      uiState.visualizedVolume?.setEraseMode(true);
                    }}
                    style={{ marginLeft: "5px" }}
                  />
                </Tooltip>
              </div>
            </Field>
            <Field label={`Kernel Size [${uiState.kernelSize}]`}>
              <Slider
                style={{ width: "200px" }}
                disabled={annotationsActionsDisabled()}
                value={uiState.kernelSize}
                min={1}
                max={200}
                onChange={(_, data) => uiState.setKernelSize(data.value)}
              />
            </Field>
          </div>
          {/* Set Clipping Plane */}
          <Field label="Clipping Plane">
            <RadioGroup
              value={uiState.visualizedVolume?.clippingPlane ?? "none"}
              onChange={(_, data) => {
                uiState.visualizedVolume?.setClippingPlane(
                  data.value as ClippingPlaneType
                );
              }}
              className={classes.clippingPlane}
              disabled={actionsDisabled()}
            >
              {clippingPlaneOptions.map((option) => (
                <Radio
                  key={option.value}
                  value={option.value}
                  label={option.label}
                />
              ))}
            </RadioGroup>
          </Field>

          <div className={classes.settingsGrid}>
            <div className={classes.settingsGridRow}>
              <ClippingPlaneOffsetSlider disabled={actionsDisabled()} />
            </div>
            <Tooltip
              content={
                <Text>
                  Shows raw volume when any clipping plane is enabled
                  <ShortcutKey content="R" />
                </Text>
              }
              relationship="description"
              appearance="inverted"
              positioning="after"
            >
              <div className={classes.settingsGridRow}>
                <Text>Show Raw Clipping Plane</Text>
                <Switch
                  disabled={
                    actionsDisabled() ||
                    uiState.visualizedVolume?.rawSettings === undefined ||
                    uiState.visualizedVolume.clippingPlane === "none"
                  }
                  checked={
                    uiState.visualizedVolume?.rawSettings !== undefined &&
                    uiState.visualizedVolume.showRawClippingPlane
                  }
                  min={1}
                  max={200}
                  onChange={(_, data) =>
                    uiState.visualizedVolume?.setShowRawClippingPlane(
                      data.checked
                    )
                  }
                />
              </div>
            </Tooltip>

            <Tooltip
              content={
                <Text>
                  Toggle fullscreen mode <ShortcutKey content="F" />
                </Text>
              }
              relationship="description"
              appearance="inverted"
              positioning="after"
            >
              <div className={classes.settingsGridRow}>
                <Text>Fullscreen</Text>
                <Switch
                  disabled={
                    actionsDisabled() ||
                    uiState.visualizedVolume?.clippingPlane === "none"
                  }
                  checked={uiState.visualizedVolume?.fullscreen ?? false}
                  min={1}
                  max={200}
                  onChange={(_, data) =>
                    uiState.visualizedVolume?.setFullscreen(data.checked)
                  }
                />
              </div>
            </Tooltip>
          </div>

          <hr
            style={{
              margin: "12px 0",
              border: "1px solid",
              borderColor: tokens.colorNeutralBackground1Hover,
            }}
          />
          <h3 style={{ fontWeight: "100", margin: 0 }}>Visibility</h3>
          {uiState.visualizedVolume?.volVisSettings && (
            <>
              <div className={classes.volumes}>
                <Text className={classes.volumesHeader} weight="semibold">
                  Name
                </Text>
                <Text className={classes.volumesHeader} weight="semibold">
                  Volume
                </Text>
                <Text className={classes.volumesHeader} weight="semibold">
                  Clipping Plane
                </Text>
                {uiState.visualizedVolume.volumeSettings.map(
                  (settingsInstance: VolVisSettingsInstance) => (
                    <div
                      key={settingsInstance.id}
                      className={classes.volumesRow}
                    >
                      <span>{settingsInstance.name.substring(0, 40)}</span>
                      <Switch
                        checked={settingsInstance.visible}
                        onChange={(_, data) => {
                          settingsInstance.setVisibility(data.checked);
                        }}
                      />
                      <Switch
                        checked={settingsInstance.clipVisible}
                        onChange={(_, data) => {
                          settingsInstance.setClipVisibility(data.checked);
                        }}
                      />
                    </div>
                  )
                )}
              </div>
              {/* TODO Readd raw volume contribution */}
              {/* {uiState.visualizedVolume.rawSettings && (
                <>
                  <h3
                    style={{ fontWeight: "100", margin: 0, marginTop: "6px" }}
                  >
                    Raw Volume Contribution
                  </h3>
                  <div style={{ display: "flex", flexDirection: "row" }}>
                    <div className={classes.sliderContainer}>
                      <Label>Min value</Label>
                      <Slider
                        value={
                          uiState.visualizedVolume.rawSettings.transferFunction
                            .rampLow * 100
                        }
                        min={0}
                        max={100}
                        onChange={(event) => handleChangeRW(event, false)}
                      />
                    </div>
                    <div className={classes.sliderContainer}>
                      <Label>Max value</Label>
                      <Slider
                        value={
                          uiState.visualizedVolume.rawSettings.transferFunction
                            .rampHigh * 100
                        }
                        min={0}
                        max={100}
                        onChange={(event) => handleChangeRW(event, true)}
                      />
                    </div>
                  </div>
                </>
              )} */}
            </>
          )}
        </div>
      </div>
    </div>
  );
});

const ClippingPlaneOffsetSlider = observer(
  ({ disabled }: { disabled: boolean }) => {
    const { uiState } = useMst();

    if (!uiState.visualizedVolume) {
      return null;
    }

    const volumeSizeX =
      uiState.visualizedVolume.renderer?.volumeManager.settings?.size.x ?? null;
    const volumeSizeY =
      uiState.visualizedVolume.renderer?.volumeManager.settings?.size.y ?? null;
    const volumeSizeZ =
      uiState.visualizedVolume.renderer?.volumeManager.settings?.size.z ?? null;

    if (uiState.visualizedVolume.clippingPlane === "x" && volumeSizeX) {
      return (
        <>
          <Text>
            Clipping Plane Offset [
            {uiState.visualizedVolume.clippingPlaneOffsetX}]
          </Text>
          <Slider
            disabled={disabled}
            value={uiState.visualizedVolume.clippingPlaneOffsetX}
            min={0}
            max={volumeSizeX - 1}
            onChange={(_, data) =>
              uiState.visualizedVolume?.setClippingOffsetX(data.value)
            }
          />
        </>
      );
    }

    if (uiState.visualizedVolume.clippingPlane === "y" && volumeSizeY) {
      return (
        <>
          <Text>
            Clipping Plane Offset [
            {uiState.visualizedVolume.clippingPlaneOffsetY}]
          </Text>
          <Slider
            disabled={disabled}
            value={uiState.visualizedVolume.clippingPlaneOffsetY}
            min={0}
            max={volumeSizeY - 1}
            onChange={(_, data) =>
              uiState.visualizedVolume?.setClippingOffsetY(data.value)
            }
          />
        </>
      );
    }

    if (uiState.visualizedVolume.clippingPlane === "z" && volumeSizeZ) {
      return (
        <>
          <Text>
            Clipping Plane Offset [
            {uiState.visualizedVolume.clippingPlaneOffsetZ}]
          </Text>
          <Slider
            disabled={disabled}
            value={uiState.visualizedVolume.clippingPlaneOffsetZ}
            min={0}
            max={volumeSizeZ - 1}
            onChange={(_, data) =>
              uiState.visualizedVolume?.setClippingOffsetZ(data.value)
            }
          />
        </>
      );
    }

    return (
      <>
        <Text>
          Clipping Plane Offset [
          {uiState.visualizedVolume.clippingPlaneOffset.toFixed(2)}]
        </Text>
        <Slider
          disabled={
            disabled || uiState.visualizedVolume.clippingPlane === "none"
          }
          value={
            uiState.visualizedVolume.clippingPlaneOffset
              ? uiState.visualizedVolume.clippingPlaneOffset * 100
              : 0
          }
          min={-100}
          max={100}
          onChange={(_, data) =>
            uiState.visualizedVolume?.setClippingOffset(data.value / 100)
          }
        />
      </>
    );
  }
);

export default Visualization;

import { useState } from "react";

import Volume from "./widgets/Volume";
import Status from "./widgets/Status";
import NanoOtzi from "./widgets/NanoOtzi";
import Models from "./widgets/Models";
import Local from "./widgets/Local";
import { observer } from "mobx-react-lite";
import { useMst } from "@/stores/RootStore";
import globalStyles from "../globalStyles";
import {
  Button,
  Divider,
  mergeClasses,
  tokens,
  Tooltip,
} from "@fluentui/react-components";
import {
  BrainCircuit24Regular,
  Cube24Regular,
  Delete24Regular,
  DesktopTower24Regular,
  Molecule24Regular,
  Status24Regular,
} from "@fluentui/react-icons";
import WidgetToggleButton from "../shared/WidgetToggleButton";
import DeleteDialog from "../shared/DeleteDialog";
import ToastContainer from "../../utils/toastContainer";
import { getErrorMessage } from "@/utils/helpers";

const enum WidgetIndices {
  Volume = 0,
  Models = 1,
  NanoOtzi = 2,
  Status = 3,
  Local = 4,
}

const SideControls = observer(() => {
  const globalClasses = globalStyles();

  const { user, uiState, pageDisabled } = useMst();
  const activeProjectId = user.userProjects.activeProjectId;

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const handleConfirmDelete = async () => {
    const activeProjectId = user.userProjects.activeProjectId;
    const toastContainer = new ToastContainer();

    if (!activeProjectId) {
      return;
    }
    try {
      user.userProjects.setProjectDeleteActiveRequest(true);
      await user.userProjects.deleteProject(activeProjectId);
      toastContainer.success("Project Deleted!");
      setIsDeleteDialogOpen(false);
    } catch (error) {
      const toastContainer = new ToastContainer();
      toastContainer.error(getErrorMessage(error));
      console.error("Error:", error);
    }
    user.userProjects.setProjectDeleteActiveRequest(false);
  };
  return (
    <>
      <div
        className={globalClasses.sidebar}
        style={{
          borderRight: `2px solid ${tokens.colorNeutralBackground1Hover}`,
        }}
      >
        <div className={globalClasses.widgetButtonContainer}>
          <WidgetToggleButton
            title={"Data"}
            labelPositioning={"after"}
            LabelIcon={Cube24Regular}
            isOpen={uiState.openLeftWidget === (WidgetIndices.Volume as number)}
            onClick={() => uiState.setOpenLeftWidget(WidgetIndices.Volume)}
            disabled={activeProjectId === undefined || pageDisabled}
          />

          <WidgetToggleButton
            title={"Neural Models"}
            labelPositioning={"after"}
            LabelIcon={BrainCircuit24Regular}
            isOpen={uiState.openLeftWidget === (WidgetIndices.Models as number)}
            onClick={() => uiState.setOpenLeftWidget(WidgetIndices.Models)}
            disabled={activeProjectId === undefined || pageDisabled}
          />

          <WidgetToggleButton
            title={"Neural Training and Inference"}
            labelPositioning={"after"}
            LabelIcon={Molecule24Regular}
            isOpen={
              uiState.openLeftWidget === (WidgetIndices.NanoOtzi as number)
            }
            onClick={() => uiState.setOpenLeftWidget(WidgetIndices.NanoOtzi)}
            disabled={activeProjectId === undefined || pageDisabled}
          />

          <WidgetToggleButton
            title={"Status"}
            labelPositioning={"after"}
            LabelIcon={Status24Regular}
            isOpen={uiState.openLeftWidget === (WidgetIndices.Status as number)}
            onClick={() => uiState.setOpenLeftWidget(WidgetIndices.Status)}
            disabled={user.isGuest || pageDisabled}
          />

          <WidgetToggleButton
            title={"Local Functions"}
            labelPositioning={"after"}
            LabelIcon={DesktopTower24Regular}
            isOpen={uiState.openLeftWidget === (WidgetIndices.Local as number)}
            onClick={() => uiState.setOpenLeftWidget(WidgetIndices.Local)}
            disabled={pageDisabled}
          />

          <Divider />

          <Tooltip
            content="Delete Project"
            relationship="label"
            appearance="inverted"
            positioning="after"
            showDelay={0}
            hideDelay={0}
            withArrow={true}
          >
            <Button
              appearance="subtle"
              size="large"
              className={mergeClasses(globalClasses.widgetButton)}
              style={{ marginTop: "auto", marginBottom: "16px" }}
              icon={<Delete24Regular />}
              onClick={() => setIsDeleteDialogOpen(true)}
              disabled={!activeProjectId || pageDisabled}
            />
          </Tooltip>
        </div>
      </div>

      <Volume
        open={uiState.openLeftWidget === (WidgetIndices.Volume as number)}
        close={uiState.closeLeftHandWidgets}
      />
      <Models
        open={uiState.openLeftWidget === (WidgetIndices.Models as number)}
        close={uiState.closeLeftHandWidgets}
      />
      <NanoOtzi
        open={uiState.openLeftWidget === (WidgetIndices.NanoOtzi as number)}
        close={uiState.closeLeftHandWidgets}
      />
      <Status
        open={uiState.openLeftWidget === (WidgetIndices.Status as number)}
        close={uiState.closeLeftHandWidgets}
      />
      <Local
        open={uiState.openLeftWidget === (WidgetIndices.Local as number)}
        close={uiState.closeLeftHandWidgets}
      />

      {/* Render the DeleteDialog */}
      <DeleteDialog
        TitleText={"Delete Project"}
        BodyText={"Do you really want to delete this project?"}
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={() => void handleConfirmDelete()}
        isActive={user.userProjects.projectDeleteActiveRequest}
      />
    </>
  );
});

export default SideControls;

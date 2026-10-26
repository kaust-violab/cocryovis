import express from 'express';
import IlastikHandler from '../../tools/ilastik-handler';
import GPUTaskHandler from '../../tools/gpu-task-handler';
import { restrictAdminAccess, restrictApi, restrictReadCheckpointAccess, restrictReadModelAccess, restrictReadProjectAccess, restrictReadResultAccess, restrictReadVolumeAccess, restrictReadVolumeDataAccess } from '../../middleware/restrict';
import appConfig from "../../tools/config";
import ProjectController from '../../controllers/project-controller';
import VolumeController from '../../controllers/volume-controller';
import VolumeDataController from '../../controllers/volume-data-controller';
import ModelController from '../../controllers/model-controller';
import CheckpointController from '../../controllers/checkpoint-controller';
import ResultController from '../../controllers/result-controller';
import IlastikController from '../../controllers/ilastik-controller';
import NanoOetziController from '../../controllers/nano-oetzi-controller';
import UserController from '../../controllers/user-controller';
import toAsyncRouter from 'async-express-decorator'
import PreProcessingController from '../../controllers/preprocessing-controller';
import DemoController from '../../controllers/demo-controller';
import CryoETController from '../../controllers/cryo-et-controller';
import NanoOetziHandler from '../../tools/nano-oetzi-handler';
import ReconstructionHandler from '../../tools/reconstruction-handler';
import GPUResourcesManager from '../../tools/gpu-resources-manager';

// Config
const config = appConfig;
const ilastikHandler = new IlastikHandler(config);
const gpuResourcesManager = await GPUResourcesManager.create();
const gpuTaskHandler = new GPUTaskHandler(config, gpuResourcesManager);
const nanoOetziHandler = new NanoOetziHandler(gpuTaskHandler, config);
const reconstructionHandler = new ReconstructionHandler(gpuTaskHandler, config);

// toAsyncRouter removes the need to call next() on async errors.
export const projectsApi = toAsyncRouter(express.Router());

///////////////////////
/////// USER
///////////////////////

projectsApi.post('/login',  UserController.login);
projectsApi.post('/logout', UserController.logout);
projectsApi.post('/register', UserController.register);
projectsApi.get('/getLoggedUserData', restrictApi, UserController.getLoggedUserData);
projectsApi.get('/users', restrictApi, UserController.getAllUsers);
projectsApi.get(`/status`, restrictApi, async (req, res) => UserController.getStatus(gpuResourcesManager, req, res));
projectsApi.get(`/gpuStatus`, restrictApi, async (req, res) => UserController.getGPUStatus(gpuResourcesManager, req, res));
projectsApi.put(`/user`, restrictApi, UserController.updateUser);
projectsApi.delete(`/user`, restrictApi, UserController.deleteUser);
projectsApi.delete(`/user-admin`, restrictAdminAccess , UserController.adminDeleteUser);


///////////////////////
/////// PROJECTS
///////////////////////

// Get Project List
// complex version of getAllUserProjectsDeep
// projectsApi.get(`/projects`, restrictApi, ProjectController.getAllUserProjects);
projectsApi.get(`/projects-deep`, restrictApi, ProjectController.getAllUserProjectsDeep);

// Create New Project
projectsApi.post(`/projects`, restrictApi, ProjectController.createProject);


// Get Project
// complex version of getProjectDeep
// projectsApi.get(`/project/:idProject`, restrictReadProjectAccess, ProjectController.getProject);
// Get Project
projectsApi.get(`/project/:idProject/deep`, restrictReadProjectAccess,
ProjectController.getProjectDeep);

// Get Project Access Info
projectsApi.get(`/project/:idProject/access`, restrictReadProjectAccess, ProjectController.getAccessInfo);

// Set Project Access Info
projectsApi.post(`/project/:idProject/access`, restrictApi, ProjectController.setAccess);

// Deep Clone Project
// projectsApi.post(`/project/:idProject/deep-clone`, restrictApi, ProjectController.deepCloneProject);

// Delete Project
projectsApi.delete(`/project/:idProject`, restrictApi, ProjectController.deleteProject);

/////// ILASTIK

// Run Ilastik inference
projectsApi.post(`/volume/:idVolume/queue-pseudo-label-generation`, restrictApi, 
    async (req, res) => IlastikController.queuePseudoLabelsGeneration(ilastikHandler, req, res));

/////// NANO OETZI

// Inference
projectsApi.post(`/queue-inference`, restrictApi,
    async (req, res) => NanoOetziController.queueInference(nanoOetziHandler, req, res));

// Run training
projectsApi.post(`/queue-training`, restrictApi,
    async (req, res) => NanoOetziController.queueTraining(nanoOetziHandler, req, res));


/////// CRYO-ET

projectsApi.post(`/tilt-series-reconstruction`, restrictApi,
    async (req, res) => PreProcessingController.queueTiltSeriesReconstruction(reconstructionHandler, req, res));

    
/////// VOLUMES

// Get Volumes from project
// projectsApi.get(`/project/:idProject/volumes`, restrictReadProjectAccess, VolumeController.getVolumesFromProject);
projectsApi.get(`/project/:idProject/volumes/deep`, restrictReadProjectAccess, VolumeController.getVolumesFromProjectDeep);

// Create New Volume
projectsApi.post(`/project/:idProject/volumes`, restrictApi, VolumeController.createVolume);

// Update Volume
projectsApi.put(`/volume/:idVolume`, restrictApi, VolumeController.update);


// Clone Volume
// projectsApi.post(`/project/:idProject/volume/:idVolume/clone`, restrictApi, VolumeController.cloneVolume);

// Get Volume
projectsApi.get(`/volume/:idVolume`, restrictReadVolumeAccess, VolumeController.getVolume);

// Remove Volume
projectsApi.delete(`/volume/:idVolume`, restrictApi, VolumeController.deleteVolume);

/////// VOLUME DATA

const readVolumeDataPrefix = "/volumeData/:type/:idVolumeData";

// Get Raw Data
projectsApi.get(readVolumeDataPrefix, restrictReadVolumeDataAccess, VolumeDataController.getById);

// Update Raw Data
projectsApi.put(readVolumeDataPrefix, restrictApi, VolumeDataController.update);

// Get Raw Data Files
projectsApi.get(`${readVolumeDataPrefix}/data`, restrictReadVolumeDataAccess, VolumeDataController.getData);

// Visualize
projectsApi.get(`${readVolumeDataPrefix}/visualization-data`, restrictReadVolumeDataAccess, VolumeDataController.getVolumeVisualizationFiles);

// Create from Files
projectsApi.post(`/volume/:idVolume/volumeData/:type/from-files`, restrictApi, VolumeDataController.createFromFiles);

// Create from Mrc File
projectsApi.post(`/volume/:idVolume/volumeData/:type/from-mrc-file`, restrictApi, VolumeDataController.createFromMrcFile);

// Create from URL
projectsApi.post(`/volume/:idVolume/volumeData/:type/from-url`, restrictApi, VolumeDataController.createFromUrl);

// Update Annotations
projectsApi.put(`/volume/:idVolume/volumeData/:type/:idVolumeData/update-annotations`, restrictApi, VolumeDataController.updateAnnotations);

    
// Download Raw Volume Data

projectsApi.get(`${readVolumeDataPrefix}/download-full`, 
VolumeDataController.downloadFullVolumeData);

projectsApi.get(`${readVolumeDataPrefix}/download-raw-file`, restrictReadVolumeDataAccess, VolumeDataController.downloadRawFile);

projectsApi.get(`${readVolumeDataPrefix}/download-settings-file`, restrictReadVolumeDataAccess, VolumeDataController.downloadSettingsFile);

projectsApi.get(`${readVolumeDataPrefix}/download-mrc-file`, restrictReadVolumeDataAccess, VolumeDataController.downloadMrcFile);

// Delete Volume Data
projectsApi.delete(`/volumeData/:type/:idVolumeData`, restrictApi, VolumeDataController.delete);
  
// CryoET Tomogram Metadata
projectsApi.get(`/cryoet/:idTomogram/`, 
    async (req, res) => CryoETController.getTomographyMetadataFromCryoETId(req, res));
    

/////// MODELS

// Get Models from Project
projectsApi.get(`/project/:idProject/models`, restrictApi, ModelController.getModelsFromProject);

// Create New Model
projectsApi.post(`/project/:idProject/models`, restrictApi, ModelController.createModel);

// Clone Model
projectsApi.post(`/project/:idProject/model/:idModel/clone`, restrictApi, ModelController.cloneModel);

// Get Model
projectsApi.get(`/model/:idModel`, restrictReadModelAccess, ModelController.getModel);

// Remove Model
projectsApi.delete(`/model/:idModel`, restrictApi, ModelController.deleteModel);

/////// CHECKPOINTS

// Get checkpoint info
projectsApi.get(`/checkpoint/:idCheckpoint`, restrictReadCheckpointAccess,CheckpointController.getCheckpoint);

// Delete checkpoint
projectsApi.delete(`/checkpoint/:idCheckpoint`, restrictApi, CheckpointController.deleteCheckpoint);

// Get checkpoints from model
projectsApi.get(`/model/:idModel/checkpoints`, restrictReadModelAccess, CheckpointController.getCheckpointsFromModel);

// Upload new checkpoints
projectsApi.post(`/model/:idModel/checkpoints`, restrictApi,CheckpointController.uploadCheckpoints);

// Download checkpoint
projectsApi.get(`/checkpoint/:idCheckpoint/download`, restrictReadCheckpointAccess, CheckpointController.downloadCheckpoint);

// Download checkpoint
projectsApi.get(`/checkpoint/:idCheckpoint/as-text`, restrictReadCheckpointAccess, CheckpointController.checkpointToText);

// Convert checkpoint to text
projectsApi.post(`/checkpoint/to-text`, CheckpointController.checkpointFileToText);

/////// RESULTS
// Get Result
projectsApi.get(`/result/:idResult`, restrictReadResultAccess, ResultController.getById);

// Get Result Details
// projectsApi.get(`/result/:idResult/details`, restrictReadResultAccess, ResultController.getDetails);

// Get Results From Volume
projectsApi.get(`/volume/:idVolume/results`, restrictReadVolumeAccess,ResultController.getFromVolume);

// Create Result from Files
projectsApi.post(`/volume/:idVolume/results`, restrictApi, ResultController.createFromFiles);

// Remove Result
projectsApi.delete(`/result/:idResult`, restrictApi,ResultController.delete);

// Result vizualization data
projectsApi.get(`/result/:idResult/data`, restrictReadResultAccess,ResultController.getResultData);


/////// DEMO
// Get Result
projectsApi.get(`/demo`, DemoController.getDemo);
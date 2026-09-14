import {
  PERMISSION_EVENTS,
  type PermissionEventMap,
} from '../constant/events/Permission';
import { SUCCESS_CODE } from '../constant/SuccessCodes';
import { PermissionService } from '../service/PermissionService';
import { withErrorHandler } from '../utils/errorHandler';
import { BaseController, type ControllerHandlers } from './BaseController';

export class PermissionController extends BaseController<PermissionEventMap> {
  private permissionService: PermissionService = new PermissionService();

  constructor() {
    const handlers = {
      [PERMISSION_EVENTS.SAVE_TOKEN]: withErrorHandler(async (req, res) => {
        await this.permissionService.saveToken(req);
        return res.ok(SUCCESS_CODE.OK);
      }, 'Failed to save token'),

      [PERMISSION_EVENTS.GET_TOKEN]: withErrorHandler(async (_req, res) => {
        const token = await this.permissionService.getToken();
        return res.ok(SUCCESS_CODE.OK, token);
      }, 'Failed to retrieve token'),

      [PERMISSION_EVENTS.DELETE_TOKEN]: withErrorHandler(async (_req, res) => {
        const deleted = await this.permissionService.deleteToken();
        return res.ok(SUCCESS_CODE.OK, deleted);
      }, 'Failed to delete token'),

      [PERMISSION_EVENTS.HAS_TOKEN]: withErrorHandler(async (_req, res) => {
        const hasToken = await this.permissionService.hasToken();
        return res.ok(SUCCESS_CODE.OK, hasToken);
      }, 'Failed to check token'),
    } satisfies ControllerHandlers<PermissionEventMap>;

    super(handlers);
  }
}

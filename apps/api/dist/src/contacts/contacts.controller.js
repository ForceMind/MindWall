"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactsController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const current_user_decorator_1 = require("../auth/current-user.decorator");
const contacts_service_1 = require("./contacts.service");
let ContactsController = class ContactsController {
    contactsService;
    constructor(contactsService) {
        this.contactsService = contactsService;
    }
    async list(user) {
        return this.contactsService.getConnectedContacts(user.userId);
    }
    async candidates(user) {
        return this.contactsService.getCandidateContacts(user.userId);
    }
    async connect(user, body) {
        return this.contactsService.connectToUser(user.userId, body.target_user_id?.trim() || '');
    }
};
exports.ContactsController = ContactsController;
__decorate([
    (0, common_1.Get)('me/list'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('me/candidates'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "candidates", null);
__decorate([
    (0, common_1.Post)('me/connect'),
    __param(0, (0, current_user_decorator_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "connect", null);
exports.ContactsController = ContactsController = __decorate([
    (0, common_1.Controller)('contacts'),
    (0, common_1.UseGuards)(auth_guard_1.SessionAuthGuard),
    __metadata("design:paramtypes", [contacts_service_1.ContactsService])
], ContactsController);
//# sourceMappingURL=contacts.controller.js.map
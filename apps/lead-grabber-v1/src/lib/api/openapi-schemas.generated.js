/**
 * GENERATED FILE - do not edit by hand.
 * Regenerate with: node scripts/gen-openapi.mjs
 */

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *     cookieAuth:
 *       type: apiKey
 *       in: cookie
 *       name: app_session
 *   schemas:
 *     Error:
 *       type: object
 *       required:
 *         - success
 *         - error
 *       properties:
 *         success:
 *           type: boolean
 *         error:
 *           type: string
 *         code:
 *           type: integer
 *     Success:
 *       type: object
 *       required:
 *         - success
 *       properties:
 *         success:
 *           type: boolean
 *     DataEnvelope:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           additionalProperties: true
 *     Company:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         name:
 *           type: string
 *         ownerId:
 *           type: string
 *         emailSlug:
 *           type: string
 *         logo:
 *           type: string
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         email:
 *           type: string
 *           format: email
 *         name:
 *           type: string
 *         role:
 *           type: string
 *         platformRole:
 *           type: string
 *         verified:
 *           type: boolean
 *         avatar:
 *           type: string
 *         company:
 *           $ref: '#/components/schemas/Company'
 *     UserTokenResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         token:
 *           type: string
 *         user:
 *           $ref: '#/components/schemas/User'
 *     CompanyPhoneNumber:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         companyId:
 *           type: string
 *         phoneNumber:
 *           type: string
 *         telnyxPhoneNumberId:
 *           type: string
 *         connectionLabel:
 *           type: string
 *         callFlowId:
 *           type: string
 *         callTrackingCategoryId:
 *           type: string
 *     Contact:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         companyId:
 *           type: string
 *         name:
 *           type: string
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *         landline:
 *           type: string
 *         cell:
 *           type: string
 *         smsPermission:
 *           type: boolean
 *         contactType:
 *           type: string
 *         avatarUrl:
 *           type: string
 *     SipCredentials:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         data:
 *           type: object
 *           properties:
 *             connectionId:
 *               type: string
 *             callerIdName:
 *               type: string
 *             callerIdNumber:
 *               type: string
 *             webrtcToken:
 *               type: string
 *               description: Short-lived JWT for the Telnyx WebRTC SDK
 * 
 */

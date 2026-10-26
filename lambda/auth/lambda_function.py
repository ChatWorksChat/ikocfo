"""
IKO CFO Auth & Admin API — Lambda handler
Endpoints: /auth/register, /auth/verify, /auth/login, /auth/resend
           /auth/mfa/* (TOTP, WebAuthn, recovery codes)
           /admin/users, /admin/users/{email}/status, /admin/users/{email}/role
           /admin/stats, /admin/send-credentials, /admin/send-mfa-reminders
"""

import json
import hashlib
import hmac
import os
import random
import re
import string
import struct
import base64
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import unquote, urlencode
import urllib.request

import boto3
from botocore.exceptions import ClientError

from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
    base64url_to_bytes,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    UserVerificationRequirement,
    ResidentKeyRequirement,
    AuthenticatorAttachment,
    PublicKeyCredentialDescriptor,
    AuthenticatorTransport,
)

# --- Configuration ---

TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'ikocfo-users')
SES_SENDER = os.environ.get('SES_SENDER', 'administrator@forwardsflow.com')
SES_REGION = os.environ.get('SES_REGION', 'eu-west-1')
PASSWORD_SALT = os.environ.get('PASSWORD_SALT', 'ikocfo-salt-2024')

# Twilio configuration
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_VERIFY_SID = os.environ.get('TWILIO_VERIFY_SID', '')

# WebAuthn configuration — env-overridable for local dev
WEBAUTHN_RP_ID = os.environ.get('WEBAUTHN_RP_ID', 'ikocfo.com')
WEBAUTHN_RP_NAME = os.environ.get('WEBAUTHN_RP_NAME', 'IKO CFO')
WEBAUTHN_ORIGIN = os.environ.get('WEBAUTHN_ORIGIN', 'https://ikocfo.com')

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
ses = boto3.client('ses', region_name=SES_REGION)

# Integration config — fields that must be masked in API responses
STRIPE_SENSITIVE_FIELDS = {'secretKey', 'webhookSecret'}
MPESA_SENSITIVE_FIELDS = {'consumerKey', 'consumerSecret', 'passkey'}

# --- Helpers ---

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        },
        'body': json.dumps(body, default=str),
    }


def hash_password(password):
    return hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        PASSWORD_SALT.encode('utf-8'),
        100_000,
    ).hex()


def generate_code():
    return ''.join(random.choices(string.digits, k=6))


def generate_password(length=12):
    chars = string.ascii_letters + string.digits + '!@#$%'
    return ''.join(random.choices(chars, k=length))


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def mask_value(value):
    """Return a masked version of a sensitive string, showing only last 4 chars."""
    if not value or len(value) <= 4:
        return '****'
    return '*' * (len(value) - 4) + value[-4:]


def send_email(to, subject, body_text, body_html=None):
    message = {
        'Subject': {'Data': subject},
        'Body': {
            'Text': {'Data': body_text},
        },
    }
    if body_html:
        message['Body']['Html'] = {'Data': body_html}

    try:
        ses.send_email(
            Source=SES_SENDER,
            Destination={'ToAddresses': [to]},
            Message=message,
        )
        return True
    except ClientError as e:
        print(f'SES error: {e}')
        return False


def send_verification_email(email, code):
    subject = 'IKO CFO — Email Verification Code'
    body = f"""Hello,

Your IKO CFO verification code is: {code}

This code expires in 30 minutes.

If you did not create an account, please ignore this email.

— IKO CFO Team
"""
    html = f"""
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #8458a3;">IKO CFO</h2>
  <p>Your verification code is:</p>
  <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #8458a3;
              padding: 20px; text-align: center; background: #f9f9ff; border-radius: 8px;
              margin: 20px 0;">{code}</div>
  <p style="color: #666;">This code expires in 30 minutes.</p>
  <p style="color: #999; font-size: 12px;">If you did not create an account, please ignore this email.</p>
</div>
"""
    return send_email(email, subject, body, html)


def send_sms_otp(phone, code):
    """Send OTP via Twilio Verify API. Returns True on success."""
    if not TWILIO_ACCOUNT_SID or not TWILIO_AUTH_TOKEN or not TWILIO_VERIFY_SID:
        print('Twilio Verify env vars not configured, skipping SMS OTP')
        return False

    url = f'https://verify.twilio.com/v2/Services/{TWILIO_VERIFY_SID}/Verifications'
    data = urlencode({
        'To': phone,
        'Channel': 'sms',
        'CustomCode': code,
    }).encode('utf-8')

    credentials = base64.b64encode(f'{TWILIO_ACCOUNT_SID}:{TWILIO_AUTH_TOKEN}'.encode('utf-8')).decode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header('Authorization', f'Basic {credentials}')
    req.add_header('Content-Type', 'application/x-www-form-urlencoded')

    try:
        resp = urllib.request.urlopen(req)
        if 200 <= resp.status < 300:
            print(f'SMS OTP sent to {phone} via Verify API')
            return True
        print(f'Twilio Verify returned status {resp.status}')
        return False
    except Exception as e:
        print(f'SMS OTP error: {e}')
        return False


def send_otp(user, code):
    """Send OTP via SMS (primary) with email fallback. Returns {'channel': 'sms'|'email'}."""
    phone = user.get('phone_number', '')
    if phone and TWILIO_ACCOUNT_SID:
        if send_sms_otp(phone, code):
            return {'channel': 'sms'}
    # Fallback to email
    send_verification_email(user['email'], code)
    return {'channel': 'email'}


def send_credentials_email(email, password):
    subject = 'IKO CFO — Your Admin Account Credentials'
    body = f"""Hello,

Your IKO CFO admin account has been created.

Email: {email}
Password: {password}

Please log in at https://main.d3e8omyd97oi7s.amplifyapp.com/login and change your password.

— IKO CFO Team
"""
    html = f"""
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #8458a3;">IKO CFO</h2>
  <p>Your admin account has been created.</p>
  <div style="background: #f9f9ff; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <p><strong>Email:</strong> {email}</p>
    <p><strong>Password:</strong> {password}</p>
  </div>
  <p>Please <a href="https://main.d3e8omyd97oi7s.amplifyapp.com/login" style="color: #8458a3;">log in</a> and change your password.</p>
</div>
"""
    return send_email(email, subject, body, html)


# --- TOTP Helpers (RFC 6238 / RFC 4226) ---

def generate_totp_secret():
    """Generate a random 20-byte secret, return as base32 string."""
    return base64.b32encode(secrets.token_bytes(20)).decode('utf-8')


def compute_totp(secret_b32, time_offset=0, digits=6, period=30):
    """Compute a TOTP code for the current time + offset periods."""
    key = base64.b32decode(secret_b32)
    counter = (int(time.time()) // period) + time_offset
    counter_bytes = struct.pack('>Q', counter)
    h = hmac.new(key, counter_bytes, hashlib.sha1).digest()
    offset = h[-1] & 0x0f
    truncated = struct.unpack('>I', h[offset:offset + 4])[0] & 0x7fffffff
    return str(truncated % (10 ** digits)).zfill(digits)


def verify_totp_code(secret_b32, code, window=1):
    """Verify a TOTP code, allowing ±window time steps."""
    code = code.strip()
    if len(code) != 6 or not code.isdigit():
        return False
    for offset in range(-window, window + 1):
        if hmac.compare_digest(compute_totp(secret_b32, offset), code):
            return True
    return False


def generate_otpauth_uri(email, secret):
    """Generate otpauth:// URI for QR code scanning."""
    issuer = 'IKO%20CFO'
    return f'otpauth://totp/{issuer}:{email}?secret={secret}&issuer={issuer}&digits=6&period=30'


# --- Recovery Code Helpers ---

def generate_recovery_codes(count=10):
    """Generate recovery codes in XXXX-XXXX format."""
    codes = []
    for _ in range(count):
        part1 = secrets.token_hex(2).upper()
        part2 = secrets.token_hex(2).upper()
        codes.append(f'{part1}-{part2}')
    return codes


def hash_recovery_code(code):
    """SHA-256 hash of a recovery code."""
    return hashlib.sha256(code.upper().strip().encode('utf-8')).hexdigest()


# --- MFA Token Helpers ---

MFA_TOKEN_SECRET = (PASSWORD_SALT + '-mfa-token').encode('utf-8')


def create_mfa_token(email):
    """Create a short-lived HMAC-signed token for MFA verification (5 min)."""
    expiry = int(time.time()) + 300
    payload = f'{email}:{expiry}'
    sig = hmac.new(MFA_TOKEN_SECRET, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f'{payload}:{sig}'


def verify_mfa_token(token):
    """Verify MFA token, return email if valid, None otherwise."""
    if not token:
        return None
    parts = token.rsplit(':', 2)
    if len(parts) != 3:
        return None
    email, expiry_str, sig = parts
    try:
        if int(time.time()) > int(expiry_str):
            return None
    except ValueError:
        return None
    expected = hmac.new(MFA_TOKEN_SECRET, f'{email}:{expiry_str}'.encode('utf-8'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    return email


# --- Auth Handlers ---

def handle_register(body):
    email = (body.get('email') or '').lower().strip()
    password = body.get('password', '')
    first_name = body.get('firstName', '')
    last_name = body.get('lastName', '')
    account_type = body.get('accountType', 'individual')
    company_name = body.get('companyName', '')
    company_address = body.get('companyAddress', '')
    position = body.get('position', '')
    phone_number = (body.get('phone_number') or '').strip()
    industry_domain = (body.get('industryDomain') or '').strip()
    company_size = (body.get('companySize') or '').strip()
    geographic_area = (body.get('geographicArea') or '').strip()

    if not email or not password:
        return response(400, {'error': 'Email and password are required.'})

    if len(password) < 8:
        return response(400, {'error': 'Password must be at least 8 characters.'})

    # Validate phone number format if provided
    if phone_number and not re.match(r'^\+\d{10,15}$', phone_number):
        return response(400, {'error': 'Phone number must be in E.164 format (e.g. +254712345678).'})

    # Check if user exists
    try:
        existing = table.get_item(Key={'email': email})
        if 'Item' in existing:
            return response(409, {'error': 'An account with this email already exists.'})
    except ClientError:
        pass

    code = generate_code()
    expires = int(time.time()) + 1800  # 30 minutes

    item = {
        'email': email,
        'password_hash': hash_password(password),
        'firstName': first_name,
        'lastName': last_name,
        'accountType': account_type,
        'companyName': company_name,
        'companyAddress': company_address,
        'position': position,
        'plan': 'free',
        'verified': False,
        'verificationCode': code,
        'codeExpiresAt': expires,
        'role': 'user',
        'status': 'active',
        'createdAt': now_iso(),
        'lastLoginAt': None,
    }
    if phone_number:
        item['phone_number'] = phone_number
    if industry_domain:
        item['industryDomain'] = industry_domain
    if company_size:
        item['companySize'] = company_size
    if geographic_area:
        item['geographicArea'] = geographic_area

    table.put_item(Item=item)
    otp_result = send_otp(item, code)

    return response(201, {'email': email, 'message': 'Verification code sent.', 'otp_channel': otp_result['channel']})


def handle_verify(body):
    email = (body.get('email') or '').lower().strip()
    code = (body.get('code') or '').strip()

    if not email or not code:
        return response(400, {'error': 'Email and code are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'No account found with this email.'})

    user = result['Item']

    if user.get('verified'):
        return response(200, {'message': 'Email already verified.'})

    if user.get('verificationCode') != code:
        return response(400, {'error': 'Invalid verification code.'})

    if int(user.get('codeExpiresAt', 0)) < int(time.time()):
        return response(400, {'error': 'Verification code has expired. Please request a new one.'})

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET verified = :v, verificationCode = :n, codeExpiresAt = :n',
        ExpressionAttributeValues={':v': True, ':n': None},
    )

    return response(200, {'message': 'Email verified successfully.'})


def build_user_data(user):
    """Build safe user data dict (no sensitive fields)."""
    has_totp = bool(user.get('mfaTotpEnabled'))
    has_webauthn = len(user.get('webauthnCredentials', [])) > 0
    return {
        'email': user['email'],
        'firstName': user.get('firstName', ''),
        'lastName': user.get('lastName', ''),
        'accountType': user.get('accountType', 'individual'),
        'companyName': user.get('companyName', ''),
        'companyAddress': user.get('companyAddress', ''),
        'position': user.get('position', ''),
        'plan': user.get('plan', 'free'),
        'verified': True,
        'role': user.get('role', 'user'),
        'status': user.get('status', 'active'),
        'createdAt': user.get('createdAt', ''),
        'mfaEnabled': has_totp or has_webauthn,
        'showWorkings': bool(user.get('showWorkings', False)),
    }


def handle_login(body):
    email = (body.get('email') or '').lower().strip()
    password = body.get('password', '')

    if not email or not password:
        return response(400, {'error': 'Email and password are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(401, {'error': 'No account found with this email.'})

    user = result['Item']

    if user.get('password_hash') != hash_password(password):
        return response(401, {'error': 'Incorrect password.'})

    if not user.get('verified'):
        return response(403, {'error': 'Please verify your email first.'})

    if user.get('status') == 'disabled':
        return response(403, {'error': 'Your account has been disabled. Please contact support.'})

    # Check if MFA is enabled (TOTP or WebAuthn)
    has_totp = bool(user.get('mfaTotpEnabled'))
    has_webauthn = len(user.get('webauthnCredentials', [])) > 0

    if has_totp or has_webauthn:
        methods = []
        if has_totp:
            methods.append('totp')
        if has_webauthn:
            methods.append('webauthn')
        mfa_token = create_mfa_token(email)
        return response(200, {
            'mfaRequired': True,
            'mfaToken': mfa_token,
            'methods': methods,
        })

    # Update last login
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET lastLoginAt = :t',
        ExpressionAttributeValues={':t': now_iso()},
    )

    user_data = build_user_data(user)

    # Prompt MFA setup for users who haven't been prompted yet
    mfa_setup_required = (
        not has_totp
        and not has_webauthn
        and not user.get('mfaPromptedAt')
    )
    if mfa_setup_required:
        table.update_item(
            Key={'email': email},
            UpdateExpression='SET mfaPromptedAt = :t',
            ExpressionAttributeValues={':t': now_iso()},
        )

    resp = {'user': user_data}
    if mfa_setup_required:
        resp['mfaSetupRequired'] = True
    return response(200, resp)


def handle_resend(body):
    email = (body.get('email') or '').lower().strip()

    if not email:
        return response(400, {'error': 'Email is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'No account found with this email.'})

    user = result['Item']
    if user.get('verified'):
        return response(200, {'message': 'Email already verified.'})

    code = generate_code()
    expires = int(time.time()) + 1800

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET verificationCode = :c, codeExpiresAt = :e',
        ExpressionAttributeValues={':c': code, ':e': expires},
    )

    otp_result = send_otp(user, code)

    return response(200, {'message': 'New verification code sent.', 'otp_channel': otp_result['channel']})


# --- Admin Handlers ---

def handle_admin_users():
    try:
        result = table.scan()
        users = []
        for item in result.get('Items', []):
            has_totp = bool(item.get('mfaTotpEnabled'))
            has_webauthn = len(item.get('webauthnCredentials', [])) > 0
            users.append({
                'email': item['email'],
                'firstName': item.get('firstName', ''),
                'lastName': item.get('lastName', ''),
                'accountType': item.get('accountType', 'individual'),
                'companyName': item.get('companyName', ''),
                'plan': item.get('plan', 'free'),
                'verified': item.get('verified', False),
                'role': item.get('role', 'user'),
                'status': item.get('status', 'active'),
                'createdAt': item.get('createdAt', ''),
                'lastLoginAt': item.get('lastLoginAt', ''),
                'mfaEnabled': has_totp or has_webauthn,
                'showWorkings': bool(item.get('showWorkings', False)),
            })
        users.sort(key=lambda u: u.get('createdAt', ''), reverse=True)
        return response(200, {'users': users})
    except ClientError as e:
        return response(500, {'error': str(e)})


def handle_admin_user_status(email, body):
    new_status = body.get('status')
    if new_status not in ('active', 'disabled'):
        return response(400, {'error': 'Status must be "active" or "disabled".'})

    try:
        table.update_item(
            Key={'email': email},
            UpdateExpression='SET #s = :s',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': new_status},
        )
        return response(200, {'message': f'User {email} is now {new_status}.'})
    except ClientError as e:
        return response(500, {'error': str(e)})


def handle_admin_user_role(email, body):
    new_role = body.get('role')
    if new_role not in ('user', 'admin'):
        return response(400, {'error': 'Role must be "user" or "admin".'})

    try:
        table.update_item(
            Key={'email': email},
            UpdateExpression='SET #r = :r',
            ExpressionAttributeNames={'#r': 'role'},
            ExpressionAttributeValues={':r': new_role},
        )
        return response(200, {'message': f'User {email} role changed to {new_role}.'})
    except ClientError as e:
        return response(500, {'error': str(e)})


def handle_admin_stats():
    try:
        result = table.scan()
        items = result.get('Items', [])

        total = len(items)
        verified = sum(1 for i in items if i.get('verified'))
        unverified = total - verified
        admins = sum(1 for i in items if i.get('role') == 'admin')

        plans = {}
        for item in items:
            p = item.get('plan', 'free')
            plans[p] = plans.get(p, 0) + 1

        # Recent registrations (last 10)
        sorted_items = sorted(items, key=lambda x: x.get('createdAt', ''), reverse=True)
        recent = []
        for item in sorted_items[:10]:
            recent.append({
                'email': item['email'],
                'firstName': item.get('firstName', ''),
                'companyName': item.get('companyName', ''),
                'createdAt': item.get('createdAt', ''),
                'verified': item.get('verified', False),
            })

        stats = {
            'totalUsers': total,
            'verifiedUsers': verified,
            'unverifiedUsers': unverified,
            'adminUsers': admins,
            'planBreakdown': plans,
            'recentRegistrations': recent,
            'totalAnalyses': 0,  # tracked client-side for now
            'sesStatus': 'Sandbox',
        }

        return response(200, {'stats': stats})
    except ClientError as e:
        return response(500, {'error': str(e)})


def handle_send_credentials(body):
    email = (body.get('email') or '').lower().strip()
    if not email:
        return response(400, {'error': 'Email is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    # Generate a new password
    new_password = generate_password()
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET password_hash = :p',
        ExpressionAttributeValues={':p': hash_password(new_password)},
    )

    sent = send_credentials_email(email, new_password)
    if sent:
        return response(200, {'message': f'Credentials sent to {email}.'})
    else:
        return response(500, {'error': 'Failed to send email. Check SES configuration.'})


# --- MFA Handlers ---

def handle_mfa_totp_setup(body):
    """Generate TOTP secret and otpauth URI for QR code."""
    email = (body.get('email') or '').lower().strip()
    if not email:
        return response(400, {'error': 'Email is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    if user.get('mfaTotpEnabled'):
        return response(400, {'error': 'TOTP is already enabled.'})

    secret = generate_totp_secret()
    otpauth_uri = generate_otpauth_uri(email, secret)

    # Store pending secret (not yet enabled)
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET mfaTotpSecret = :s',
        ExpressionAttributeValues={':s': secret},
    )

    return response(200, {
        'secret': secret,
        'otpauthUri': otpauth_uri,
    })


def handle_mfa_totp_verify_setup(body):
    """Verify TOTP code during setup, enable TOTP, return recovery codes."""
    email = (body.get('email') or '').lower().strip()
    code = (body.get('code') or '').strip()

    if not email or not code:
        return response(400, {'error': 'Email and code are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    secret = user.get('mfaTotpSecret')
    if not secret:
        return response(400, {'error': 'No TOTP setup in progress. Start setup first.'})

    if user.get('mfaTotpEnabled'):
        return response(400, {'error': 'TOTP is already enabled.'})

    if not verify_totp_code(secret, code):
        return response(400, {'error': 'Invalid code. Please try again.'})

    # Generate recovery codes
    recovery_codes = generate_recovery_codes()
    hashed_codes = [hash_recovery_code(c) for c in recovery_codes]

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET mfaTotpEnabled = :e, mfaTotpVerifiedAt = :t, mfaRecoveryCodes = :rc, mfaRecoveryCodesGeneratedAt = :rg',
        ExpressionAttributeValues={
            ':e': True,
            ':t': now_iso(),
            ':rc': hashed_codes,
            ':rg': now_iso(),
        },
    )

    return response(200, {
        'enabled': True,
        'recoveryCodes': recovery_codes,
    })


def handle_mfa_totp_disable(body):
    """Disable TOTP (requires password confirmation)."""
    email = (body.get('email') or '').lower().strip()
    password = body.get('password', '')

    if not email or not password:
        return response(400, {'error': 'Email and password are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    if user.get('password_hash') != hash_password(password):
        return response(401, {'error': 'Incorrect password.'})

    table.update_item(
        Key={'email': email},
        UpdateExpression='REMOVE mfaTotpSecret, mfaTotpEnabled, mfaTotpVerifiedAt, mfaRecoveryCodes, mfaRecoveryCodesGeneratedAt',
    )

    return response(200, {'disabled': True})


def handle_mfa_verify(body):
    """Verify TOTP or recovery code during login (mfaToken required)."""
    mfa_token = body.get('mfaToken', '')
    code = (body.get('code') or '').strip()
    method = body.get('method', 'totp')

    if not mfa_token:
        return response(400, {'error': 'MFA token is required.'})

    email = verify_mfa_token(mfa_token)
    if not email:
        return response(401, {'error': 'MFA session expired. Please log in again.'})

    if not code:
        return response(400, {'error': 'Verification code is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']

    if method == 'recovery':
        # Verify recovery code
        hashed = hash_recovery_code(code)
        stored_codes = user.get('mfaRecoveryCodes', [])
        if hashed not in stored_codes:
            return response(400, {'error': 'Invalid recovery code.'})

        # Remove used code
        updated_codes = [c for c in stored_codes if c != hashed]
        table.update_item(
            Key={'email': email},
            UpdateExpression='SET mfaRecoveryCodes = :rc, lastLoginAt = :t',
            ExpressionAttributeValues={':rc': updated_codes, ':t': now_iso()},
        )
    else:
        # Verify TOTP code
        secret = user.get('mfaTotpSecret')
        if not secret or not verify_totp_code(secret, code):
            return response(400, {'error': 'Invalid verification code.'})

        table.update_item(
            Key={'email': email},
            UpdateExpression='SET lastLoginAt = :t',
            ExpressionAttributeValues={':t': now_iso()},
        )

    return response(200, {'user': build_user_data(user)})


def handle_mfa_status(body):
    """Return MFA status for a user."""
    email = (body.get('email') or '').lower().strip()
    if not email:
        return response(400, {'error': 'Email is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    recovery_count = len(user.get('mfaRecoveryCodes', []))
    webauthn_creds = user.get('webauthnCredentials', [])
    webauthn_list = [
        {'id': c['credentialId'], 'name': c.get('friendlyName', 'Fingerprint'), 'createdAt': c.get('createdAt', '')}
        for c in webauthn_creds
    ]

    return response(200, {
        'totpEnabled': bool(user.get('mfaTotpEnabled')),
        'webauthnEnabled': len(webauthn_creds) > 0,
        'webauthnCredentials': webauthn_list,
        'recoveryCodesRemaining': recovery_count,
    })


def handle_mfa_recovery_regenerate(body):
    """Regenerate recovery codes (requires password)."""
    email = (body.get('email') or '').lower().strip()
    password = body.get('password', '')

    if not email or not password:
        return response(400, {'error': 'Email and password are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    if user.get('password_hash') != hash_password(password):
        return response(401, {'error': 'Incorrect password.'})

    if not user.get('mfaTotpEnabled'):
        return response(400, {'error': 'MFA is not enabled.'})

    recovery_codes = generate_recovery_codes()
    hashed_codes = [hash_recovery_code(c) for c in recovery_codes]

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET mfaRecoveryCodes = :rc, mfaRecoveryCodesGeneratedAt = :t',
        ExpressionAttributeValues={':rc': hashed_codes, ':t': now_iso()},
    )

    return response(200, {'recoveryCodes': recovery_codes})


# --- WebAuthn Handlers ---

def handle_webauthn_register_options(body):
    """Generate WebAuthn registration options (triggers browser fingerprint/security key prompt)."""
    email = (body.get('email') or '').lower().strip()
    if not email:
        return response(400, {'error': 'Email is required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']

    # Generate or reuse a stable user handle
    user_id = user.get('webauthnUserId')
    if user_id:
        user_id_bytes = base64url_to_bytes(user_id)
    else:
        user_id_bytes = secrets.token_bytes(32)
        user_id = bytes_to_base64url(user_id_bytes)

    # Build exclude list from existing credentials
    existing_creds = user.get('webauthnCredentials', [])
    exclude = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c['credentialId']))
        for c in existing_creds
    ]

    options = generate_registration_options(
        rp_id=WEBAUTHN_RP_ID,
        rp_name=WEBAUTHN_RP_NAME,
        user_name=email,
        user_id=user_id_bytes,
        user_display_name=f"{user.get('firstName', '')} {user.get('lastName', '')}".strip() or email,
        exclude_credentials=exclude,
        authenticator_selection=AuthenticatorSelectionCriteria(
            authenticator_attachment=AuthenticatorAttachment.PLATFORM,
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
    )

    # Store the challenge and user ID for verification
    challenge_b64 = bytes_to_base64url(options.challenge)
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET webauthnChallenge = :c, webauthnUserId = :u',
        ExpressionAttributeValues={':c': challenge_b64, ':u': user_id},
    )

    return response(200, json.loads(options_to_json(options)))


def handle_webauthn_register_verify(body):
    """Verify WebAuthn registration attestation and store credential."""
    email = (body.get('email') or '').lower().strip()
    credential = body.get('credential')
    friendly_name = body.get('friendlyName', 'Fingerprint')

    if not email or not credential:
        return response(400, {'error': 'Email and credential are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    challenge_b64 = user.get('webauthnChallenge')
    if not challenge_b64:
        return response(400, {'error': 'No registration in progress.'})

    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            require_user_verification=False,
        )
    except Exception as e:
        print(f'WebAuthn registration verification failed: {e}')
        return response(400, {'error': f'Registration verification failed: {str(e)}'})

    # Store the credential
    new_cred = {
        'credentialId': bytes_to_base64url(verification.credential_id),
        'publicKey': bytes_to_base64url(verification.credential_public_key),
        'counter': verification.sign_count,
        'friendlyName': friendly_name,
        'createdAt': now_iso(),
    }

    existing_creds = user.get('webauthnCredentials', [])
    existing_creds.append(new_cred)

    # Generate recovery codes if this is the first MFA method
    has_totp = bool(user.get('mfaTotpEnabled'))
    has_existing_codes = len(user.get('mfaRecoveryCodes', [])) > 0
    recovery_codes = None

    update_expr = 'SET webauthnCredentials = :wc, webauthnChallenge = :n'
    expr_values = {':wc': existing_creds, ':n': None}

    if not has_totp and not has_existing_codes:
        recovery_codes = generate_recovery_codes()
        hashed_codes = [hash_recovery_code(c) for c in recovery_codes]
        update_expr += ', mfaRecoveryCodes = :rc, mfaRecoveryCodesGeneratedAt = :rg'
        expr_values[':rc'] = hashed_codes
        expr_values[':rg'] = now_iso()

    table.update_item(
        Key={'email': email},
        UpdateExpression=update_expr,
        ExpressionAttributeValues=expr_values,
    )

    resp = {'registered': True, 'credentialId': new_cred['credentialId']}
    if recovery_codes:
        resp['recoveryCodes'] = recovery_codes
    return response(200, resp)


def handle_webauthn_auth_options(body):
    """Generate WebAuthn authentication options (for MFA challenge during login)."""
    mfa_token = body.get('mfaToken', '')
    if not mfa_token:
        return response(400, {'error': 'MFA token is required.'})

    email = verify_mfa_token(mfa_token)
    if not email:
        return response(401, {'error': 'MFA session expired. Please log in again.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    creds = user.get('webauthnCredentials', [])
    if not creds:
        return response(400, {'error': 'No WebAuthn credentials registered.'})

    allow = [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(c['credentialId']))
        for c in creds
    ]

    options = generate_authentication_options(
        rp_id=WEBAUTHN_RP_ID,
        allow_credentials=allow,
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    challenge_b64 = bytes_to_base64url(options.challenge)
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET webauthnChallenge = :c',
        ExpressionAttributeValues={':c': challenge_b64},
    )

    return response(200, json.loads(options_to_json(options)))


def handle_webauthn_auth_verify(body):
    """Verify WebAuthn authentication assertion during login."""
    mfa_token = body.get('mfaToken', '')
    credential = body.get('credential')

    if not mfa_token or not credential:
        return response(400, {'error': 'MFA token and credential are required.'})

    email = verify_mfa_token(mfa_token)
    if not email:
        return response(401, {'error': 'MFA session expired. Please log in again.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    challenge_b64 = user.get('webauthnChallenge')
    if not challenge_b64:
        return response(400, {'error': 'No authentication challenge found.'})

    # Find the matching credential
    cred_id = credential.get('id', '')
    stored_creds = user.get('webauthnCredentials', [])
    matched_cred = None
    matched_idx = None
    for idx, c in enumerate(stored_creds):
        if c['credentialId'] == cred_id:
            matched_cred = c
            matched_idx = idx
            break

    if not matched_cred:
        return response(400, {'error': 'Credential not recognized.'})

    try:
        verification = verify_authentication_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(challenge_b64),
            expected_rp_id=WEBAUTHN_RP_ID,
            expected_origin=WEBAUTHN_ORIGIN,
            credential_public_key=base64url_to_bytes(matched_cred['publicKey']),
            credential_current_sign_count=int(matched_cred.get('counter', 0)),
            require_user_verification=False,
        )
    except Exception as e:
        print(f'WebAuthn authentication verification failed: {e}')
        return response(400, {'error': 'Fingerprint verification failed. Please try again.'})

    # Update counter and last login
    stored_creds[matched_idx]['counter'] = verification.new_sign_count
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET webauthnCredentials = :wc, webauthnChallenge = :n, lastLoginAt = :t',
        ExpressionAttributeValues={':wc': stored_creds, ':n': None, ':t': now_iso()},
    )

    return response(200, {'user': build_user_data(user)})


def handle_webauthn_remove(body):
    """Remove a WebAuthn credential."""
    email = (body.get('email') or '').lower().strip()
    credential_id = body.get('credentialId', '')
    password = body.get('password', '')

    if not email or not credential_id or not password:
        return response(400, {'error': 'Email, credentialId, and password are required.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']
    if user.get('password_hash') != hash_password(password):
        return response(401, {'error': 'Incorrect password.'})

    stored_creds = user.get('webauthnCredentials', [])
    updated_creds = [c for c in stored_creds if c['credentialId'] != credential_id]

    if len(updated_creds) == len(stored_creds):
        return response(404, {'error': 'Credential not found.'})

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET webauthnCredentials = :wc',
        ExpressionAttributeValues={':wc': updated_creds},
    )

    return response(200, {'removed': True})


# --- Invite Token Helpers ---

INVITE_TOKEN_SECRET = (PASSWORD_SALT + '-invite-token').encode('utf-8')


def create_invite_token(email):
    """Create an HMAC-signed invite token valid for 7 days."""
    expiry = int(time.time()) + 604800  # 7 days
    payload = f'{email}:{expiry}'
    sig = hmac.new(INVITE_TOKEN_SECRET, payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f'{payload}:{sig}'


def verify_invite_token(token):
    """Verify invite token, return email if valid, None otherwise."""
    if not token:
        return None
    parts = token.rsplit(':', 2)
    if len(parts) != 3:
        return None
    email, expiry_str, sig = parts
    try:
        if int(time.time()) > int(expiry_str):
            return None
    except ValueError:
        return None
    expected = hmac.new(INVITE_TOKEN_SECRET, f'{email}:{expiry_str}'.encode('utf-8'), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    return email


APP_URL = os.environ.get('APP_URL', 'https://main.d3e8omyd97oi7s.amplifyapp.com')


def send_invite_email(email, first_name, invite_token):
    """Send invitation email with signup link."""
    subject = 'IKO CFO — You\'ve Been Invited!'
    name = first_name or 'there'
    invite_url = f'{APP_URL}/invite/accept?token={invite_token}'
    body = f"""Hi {name},

You've been invited to join IKO CFO.

Click the link below to set up your account:
{invite_url}

This invitation expires in 7 days.

— IKO CFO Team
"""
    html = f"""
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #8458a3;">IKO CFO</h2>
  <p>Hi {name},</p>
  <p>You've been invited to join <strong>IKO CFO</strong>.</p>
  <p>Click the button below to set up your account, create your password, and enable two-factor authentication.</p>
  <div style="text-align: center; margin: 24px 0;">
    <a href="{invite_url}" style="display: inline-block; padding: 14px 32px; background: #8458a3; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
      Accept Invitation
    </a>
  </div>
  <p style="color: #666; font-size: 13px;">This invitation expires in 7 days.</p>
  <p style="color: #999; font-size: 12px;">— IKO CFO Team</p>
</div>
"""
    return send_email(email, subject, body, html)


# --- Admin CRUD Handlers ---

def handle_admin_invite(body):
    """Create an invited user and send invitation email."""
    email = (body.get('email') or '').lower().strip()
    first_name = body.get('firstName', '')
    last_name = body.get('lastName', '')
    account_type = body.get('accountType', 'individual')
    company_name = body.get('companyName', '')
    role = body.get('role', 'user')

    if not email:
        return response(400, {'error': 'Email is required.'})

    # Check if user already exists
    try:
        existing = table.get_item(Key={'email': email})
        if 'Item' in existing:
            return response(409, {'error': 'An account with this email already exists.'})
    except ClientError:
        pass

    if role not in ('user', 'admin'):
        role = 'user'

    # Create user record with status 'invited' (no password yet)
    item = {
        'email': email,
        'firstName': first_name,
        'lastName': last_name,
        'accountType': account_type,
        'companyName': company_name,
        'companyAddress': '',
        'position': '',
        'plan': 'free',
        'verified': False,
        'role': role,
        'status': 'invited',
        'createdAt': now_iso(),
        'lastLoginAt': None,
    }
    table.put_item(Item=item)

    # Generate invite token and send email
    invite_token = create_invite_token(email)
    sent = send_invite_email(email, first_name, invite_token)

    if sent:
        return response(201, {'message': f'Invitation sent to {email}.', 'email': email})
    else:
        return response(201, {
            'message': f'User created but email failed to send (SES). Share the invitation link manually.',
            'email': email,
            'inviteUrl': f'{APP_URL}/invite/accept?token={invite_token}',
        })


def handle_accept_invite(body):
    """Accept an invitation: validate token, set password, activate account."""
    token = body.get('token', '')
    password = body.get('password', '')

    if not token:
        return response(400, {'error': 'Invitation token is required.'})

    email = verify_invite_token(token)
    if not email:
        return response(401, {'error': 'Invalid or expired invitation link. Please contact your administrator.'})

    if not password:
        return response(400, {'error': 'Password is required.'})

    # Password strength requirements: min 8 chars, at least 1 uppercase, 1 lowercase, 1 digit
    if len(password) < 8:
        return response(400, {'error': 'Password must be at least 8 characters.'})
    if not any(c.isupper() for c in password):
        return response(400, {'error': 'Password must contain at least one uppercase letter.'})
    if not any(c.islower() for c in password):
        return response(400, {'error': 'Password must contain at least one lowercase letter.'})
    if not any(c.isdigit() for c in password):
        return response(400, {'error': 'Password must contain at least one number.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(404, {'error': 'User not found.'})

    user = result['Item']

    if user.get('status') != 'invited':
        return response(400, {'error': 'This invitation has already been accepted.'})

    # Set password, mark verified and active
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET password_hash = :p, verified = :v, #s = :s',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={
            ':p': hash_password(password),
            ':v': True,
            ':s': 'active',
        },
    )

    # Return user data so frontend can set session
    user['verified'] = True
    user['status'] = 'active'
    user_data = build_user_data(user)

    return response(200, {'user': user_data, 'mfaSetupRequired': True})


def handle_admin_edit_user(email, body):
    """Edit user fields (firstName, lastName, role, plan, accountType, companyName)."""
    allowed_fields = {
        'firstName': 'firstName',
        'lastName': 'lastName',
        'role': 'role',
        'plan': 'plan',
        'accountType': 'accountType',
        'companyName': 'companyName',
        'showWorkings': 'showWorkings',
    }

    update_parts = []
    expr_names = {}
    expr_values = {}

    for key, attr in allowed_fields.items():
        if key in body:
            placeholder = f':v_{key}'
            # 'role' and 'status' are reserved words in DynamoDB
            if attr in ('role', 'status', 'plan'):
                alias = f'#a_{attr}'
                expr_names[alias] = attr
                update_parts.append(f'{alias} = {placeholder}')
            else:
                update_parts.append(f'{attr} = {placeholder}')
            value = body[key]
            if key == 'showWorkings':
                value = bool(value)
            expr_values[placeholder] = value

    if not update_parts:
        return response(400, {'error': 'No fields to update.'})

    # Validate role if provided
    if 'role' in body and body['role'] not in ('user', 'admin'):
        return response(400, {'error': 'Role must be "user" or "admin".'})

    try:
        result = table.get_item(Key={'email': email})
        if 'Item' not in result:
            return response(404, {'error': 'User not found.'})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    update_expr = 'SET ' + ', '.join(update_parts)

    kwargs = {
        'Key': {'email': email},
        'UpdateExpression': update_expr,
        'ExpressionAttributeValues': expr_values,
    }
    if expr_names:
        kwargs['ExpressionAttributeNames'] = expr_names

    try:
        table.update_item(**kwargs)
        return response(200, {'message': f'User {email} updated.'})
    except ClientError as e:
        return response(500, {'error': str(e)})


def handle_admin_delete_user(email):
    """Delete a user from DynamoDB."""
    try:
        result = table.get_item(Key={'email': email})
        if 'Item' not in result:
            return response(404, {'error': 'User not found.'})

        table.delete_item(Key={'email': email})
        return response(200, {'message': f'User {email} has been deleted.'})
    except ClientError as e:
        return response(500, {'error': str(e)})


# --- MFA Reminder Email ---

def send_mfa_reminder_email(email, first_name):
    """Send MFA setup reminder email."""
    subject = 'IKO CFO — Secure Your Account with Two-Factor Authentication'
    name = first_name or 'there'
    body = f"""Hi {name},

We've added two-factor authentication (2FA) to IKO CFO to help keep your account secure.

You can now protect your account with:
- Google Authenticator (or any TOTP app)
- Fingerprint / Windows Hello / Touch ID

Set up 2FA now by logging in and visiting your Security Settings.

Log in: https://main.d3e8omyd97oi7s.amplifyapp.com/login

After logging in, you'll be prompted to set up 2FA, or you can go to Settings > Security at any time.

— IKO CFO Team
"""
    html = f"""
<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #8458a3;">IKO CFO</h2>
  <p>Hi {name},</p>
  <p>We've added <strong>two-factor authentication (2FA)</strong> to IKO CFO to help keep your account secure.</p>
  <div style="background: #f9f9ff; border-radius: 8px; padding: 20px; margin: 20px 0;">
    <p style="margin: 0 0 8px;"><strong>You can now protect your account with:</strong></p>
    <ul style="margin: 0; padding-left: 20px;">
      <li>Google Authenticator (or any TOTP app)</li>
      <li>Fingerprint / Windows Hello / Touch ID</li>
    </ul>
  </div>
  <div style="text-align: center; margin: 24px 0;">
    <a href="https://main.d3e8omyd97oi7s.amplifyapp.com/login" style="display: inline-block; padding: 14px 32px; background: #8458a3; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold;">
      Set Up 2FA Now
    </a>
  </div>
  <p style="color: #666; font-size: 13px;">After logging in, you'll be prompted to set up 2FA, or you can visit Settings &gt; Security at any time.</p>
  <p style="color: #999; font-size: 12px;">— IKO CFO Team</p>
</div>
"""
    return send_email(email, subject, body, html)


def handle_send_mfa_reminders(body):
    """Send MFA setup reminder emails to all active users without MFA."""
    try:
        result = table.scan()
        items = result.get('Items', [])
    except ClientError as e:
        return response(500, {'error': str(e)})

    sent = 0
    failed = 0
    errors = []

    for item in items:
        if not item.get('verified'):
            continue
        if item.get('status') == 'disabled':
            continue
        if item.get('mfaTotpEnabled'):
            continue
        if len(item.get('webauthnCredentials', [])) > 0:
            continue

        email = item['email']
        first_name = item.get('firstName', '')
        ok = send_mfa_reminder_email(email, first_name)
        if ok:
            sent += 1
        else:
            failed += 1
            errors.append(email)

    return response(200, {
        'sent': sent,
        'failed': failed,
        'errors': errors,
        'message': f'MFA reminders sent: {sent} succeeded, {failed} failed.',
    })


# --- Bank Rates CRUD ---

import uuid as _uuid


def handle_get_bank_rates():
    """Return all bank rate records from DynamoDB."""
    try:
        result = table.scan(
            FilterExpression='begins_with(email, :prefix)',
            ExpressionAttributeValues={':prefix': 'bankrate#'},
        )
        rates = []
        for item in result.get('Items', []):
            rates.append({
                'id': item['email'].replace('bankrate#', ''),
                'name': item.get('name', ''),
                'aliases': json.loads(item['aliases']) if isinstance(item.get('aliases'), str) else item.get('aliases', []),
                'odAPR': float(item.get('odAPR', 0)),
                'currency': item.get('currency', 'KES'),
                'country': item.get('country', 'Kenya'),
                'type': item.get('bankType', 'commercial'),
                'createdAt': item.get('createdAt', ''),
                'updatedAt': item.get('updatedAt', ''),
            })
        rates.sort(key=lambda r: r['name'])
        return response(200, {'rates': rates})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to fetch bank rates.'})


def handle_add_bank_rate(body):
    """Create a new bank rate record."""
    name = (body.get('name') or '').strip()
    od_apr = body.get('odAPR')
    currency = body.get('currency', 'KES')
    country = body.get('country', 'Kenya')
    aliases = body.get('aliases', [])
    bank_type = body.get('type', 'commercial')

    if not name:
        return response(400, {'error': 'Bank name is required.'})
    if od_apr is None or float(od_apr) < 0:
        return response(400, {'error': 'A valid OD APR is required.'})

    rate_id = str(_uuid.uuid4())[:8]
    now = now_iso()

    # Build aliases: always include the full name and common abbreviations
    if not aliases:
        aliases = [name]
    elif name not in aliases:
        aliases.insert(0, name)

    item = {
        'email': f'bankrate#{rate_id}',
        'name': name,
        'aliases': json.dumps(aliases),
        'odAPR': str(od_apr),
        'currency': currency,
        'country': country,
        'bankType': bank_type,
        'createdAt': now,
        'updatedAt': now,
    }

    try:
        table.put_item(Item=item)
        return response(201, {
            'id': rate_id,
            'name': name,
            'odAPR': float(od_apr),
            'currency': currency,
            'country': country,
            'type': bank_type,
            'aliases': aliases,
            'createdAt': now,
        })
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to create bank rate.'})


def handle_update_bank_rate(rate_id, body):
    """Update an existing bank rate record."""
    key = f'bankrate#{rate_id}'

    # Verify record exists
    try:
        result = table.get_item(Key={'email': key})
        if 'Item' not in result:
            return response(404, {'error': 'Bank rate not found.'})
    except ClientError:
        return response(404, {'error': 'Bank rate not found.'})

    update_parts = []
    values = {}

    if 'name' in body:
        update_parts.append('#n = :name')
        values[':name'] = body['name'].strip()
    if 'odAPR' in body:
        update_parts.append('odAPR = :apr')
        values[':apr'] = str(body['odAPR'])
    if 'currency' in body:
        update_parts.append('currency = :cur')
        values[':cur'] = body['currency']
    if 'country' in body:
        update_parts.append('country = :ctry')
        values[':ctry'] = body['country']
    if 'aliases' in body:
        update_parts.append('aliases = :al')
        values[':al'] = json.dumps(body['aliases'])
    if 'type' in body:
        update_parts.append('bankType = :bt')
        values[':bt'] = body['type']

    if not update_parts:
        return response(400, {'error': 'No fields to update.'})

    update_parts.append('updatedAt = :ua')
    values[':ua'] = now_iso()

    attr_names = {}
    if '#n = :name' in update_parts:
        attr_names['#n'] = 'name'

    try:
        kwargs = {
            'Key': {'email': key},
            'UpdateExpression': 'SET ' + ', '.join(update_parts),
            'ExpressionAttributeValues': values,
        }
        if attr_names:
            kwargs['ExpressionAttributeNames'] = attr_names
        table.update_item(**kwargs)
        return response(200, {'updated': True, 'id': rate_id})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to update bank rate.'})


def handle_delete_bank_rate(rate_id):
    """Delete a bank rate record."""
    key = f'bankrate#{rate_id}'
    try:
        table.delete_item(Key={'email': key})
        return response(200, {'deleted': True, 'id': rate_id})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to delete bank rate.'})


# --- Bank Template Comprehension ---

SEED_BANK_TEMPLATES = [
    {
        'email': 'banktemplate#victoria-commercial-bank',
        'bankName': 'Victoria Commercial Bank Limited',
        'bankSlug': 'victoria-commercial-bank',
        'aliases': json.dumps(['Victoria Commercial Bank', 'VCB', 'victoriabank.co.ke']),
        'columnHeaders': json.dumps(['DATE', 'VALUE', 'PARTICULARS', 'CHQ/REF', 'DEBIT', 'CREDIT', 'BALANCE']),
        'columnMapping': json.dumps({'DATE': 'date', 'VALUE': 'valueDate', 'PARTICULARS': 'description', 'CHQ/REF': 'ignore', 'DEBIT': 'debit', 'CREDIT': 'credit', 'BALANCE': 'balance'}),
        'dateFormats': json.dumps(['DD-MMM-YYYY']),
        'interestPatterns': json.dumps([{'regex': '\\d+:Int\\.Coll:', 'classification': 'account_prefixed'}]),
        'feePatterns': json.dumps(['Ledger Fee', 'Excise duty', 'Standing Instruction', 'SWIFT CHARGES', 'COMMITMENT FEE']),
        'openingBalanceMethod': 'brought_forward',
        'openingBalancePattern': 'Brought Forward',
        'transactionOrder': 'chronological',
        'multiPageRepeatRow': 'Brought Forward',
        'closingMarkers': json.dumps(['Grand Total', 'Unclear Balance', 'Ledger Balance']),
        'currency': 'KES',
        'statementCount': 0,
    },
    {
        'email': 'banktemplate#i-and-m-bank',
        'bankName': 'I & M Bank Limited',
        'bankSlug': 'i-and-m-bank',
        'aliases': json.dumps(['I&M Bank', 'I & M Bank', 'I & M Bank Limited', 'I&M']),
        'columnHeaders': json.dumps(['Transaction date', 'Value date', 'Description/Narration', 'Transaction reference', 'Withdrawal', 'Deposit', 'Balance']),
        'columnMapping': json.dumps({'Transaction date': 'date', 'Value date': 'valueDate', 'Description/Narration': 'description', 'Transaction reference': 'ignore', 'Withdrawal': 'debit', 'Deposit': 'credit', 'Balance': 'balance'}),
        'dateFormats': json.dumps(['DD-MMM-YYYY']),
        'interestPatterns': json.dumps([{'regex': '\\d+:Int\\.Coll:', 'classification': 'account_prefixed'}]),
        'feePatterns': json.dumps(['CHARGE ACCT MAINTENANCE', 'EXCISE DUTY']),
        'openingBalanceMethod': 'preamble',
        'openingBalancePattern': 'Opening balance',
        'transactionOrder': 'chronological',
        'multiPageRepeatRow': '',
        'closingMarkers': json.dumps([]),
        'currency': 'KES',
        'statementCount': 0,
    },
    {
        'email': 'banktemplate#bank-of-africa',
        'bankName': 'Bank of Africa Ltd',
        'bankSlug': 'bank-of-africa',
        'aliases': json.dumps(['BANK OF AFRICA', 'BOA', 'BANK OF AFRICA - KENYA', 'BANK OF AFRICA -  KENYA']),
        'columnHeaders': json.dumps(['Op. Date', 'Description', 'Reference', 'Value date', 'Debit', 'Credit', 'Running balance']),
        'columnMapping': json.dumps({'Op. Date': 'date', 'Description': 'description', 'Reference': 'ignore', 'Value date': 'valueDate', 'Debit': 'debit', 'Credit': 'credit', 'Running balance': 'balance'}),
        'dateFormats': json.dumps(['DD/MM/YY', 'DD/MM/YYYY']),
        'interestPatterns': json.dumps([{'keyword': 'DEBITOR INTERESTS', 'classification': 'overdraft_interest'}, {'keyword': 'REVERSAL OF DEBITOR INTEREST', 'classification': 'interest_reversal'}]),
        'feePatterns': json.dumps(['COMMITMENT COMMISSION', 'EXCISE TAX']),
        'openingBalanceMethod': 'preamble',
        'openingBalancePattern': 'Opening balance',
        'transactionOrder': 'reverse_chronological',
        'multiPageRepeatRow': '',
        'closingMarkers': json.dumps([]),
        'currency': 'KES',
        'statementCount': 0,
    },
]


def _parse_template_item(item):
    """Convert a DynamoDB template item to API response format."""
    def _safe_json(val):
        if isinstance(val, str):
            try:
                return json.loads(val)
            except (json.JSONDecodeError, ValueError):
                return val
        return val

    return {
        'bankSlug': item.get('bankSlug', ''),
        'bankName': item.get('bankName', ''),
        'aliases': _safe_json(item.get('aliases', '[]')),
        'columnHeaders': _safe_json(item.get('columnHeaders', '[]')),
        'columnMapping': _safe_json(item.get('columnMapping', '{}')),
        'dateFormats': _safe_json(item.get('dateFormats', '[]')),
        'interestPatterns': _safe_json(item.get('interestPatterns', '[]')),
        'feePatterns': _safe_json(item.get('feePatterns', '[]')),
        'openingBalanceMethod': item.get('openingBalanceMethod', 'first_transaction'),
        'openingBalancePattern': item.get('openingBalancePattern', ''),
        'transactionOrder': item.get('transactionOrder', 'chronological'),
        'multiPageRepeatRow': item.get('multiPageRepeatRow', ''),
        'closingMarkers': _safe_json(item.get('closingMarkers', '[]')),
        'currency': item.get('currency', 'KES'),
        'statementCount': int(item.get('statementCount', 0)),
        'createdAt': item.get('createdAt', ''),
        'updatedAt': item.get('updatedAt', ''),
    }


def _seed_bank_templates():
    """Seed the 3 initial bank templates if none exist yet."""
    now = now_iso()
    seeded = 0
    for tpl in SEED_BANK_TEMPLATES:
        try:
            result = table.get_item(Key={'email': tpl['email']})
            if 'Item' not in result:
                item = {**tpl, 'createdAt': now, 'updatedAt': now}
                table.put_item(Item=item)
                seeded += 1
        except ClientError:
            pass
    return seeded


def handle_get_bank_templates():
    """Return all bank template records — seeds defaults on first call."""
    try:
        result = table.scan(
            FilterExpression='begins_with(email, :prefix)',
            ExpressionAttributeValues={':prefix': 'banktemplate#'},
        )
        items = result.get('Items', [])

        # Auto-seed if no templates exist yet
        if not items:
            _seed_bank_templates()
            result = table.scan(
                FilterExpression='begins_with(email, :prefix)',
                ExpressionAttributeValues={':prefix': 'banktemplate#'},
            )
            items = result.get('Items', [])

        templates = [_parse_template_item(item) for item in items]
        templates.sort(key=lambda t: t['bankName'])
        return response(200, {'templates': templates})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to fetch bank templates.'})


def handle_get_bank_template(slug):
    """Return a single bank template by slug."""
    key = f'banktemplate#{slug}'
    try:
        result = table.get_item(Key={'email': key})
        if 'Item' not in result:
            return response(404, {'error': 'Bank template not found.'})
        return response(200, _parse_template_item(result['Item']))
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to fetch bank template.'})


def handle_save_bank_template(body):
    """Create or update a bank template (upsert by slug)."""
    slug = (body.get('bankSlug') or '').strip()
    bank_name = (body.get('bankName') or '').strip()

    if not slug:
        return response(400, {'error': 'bankSlug is required.'})
    if not bank_name:
        return response(400, {'error': 'bankName is required.'})

    now = now_iso()
    key = f'banktemplate#{slug}'

    # Check if existing — preserve createdAt
    created_at = now
    try:
        existing = table.get_item(Key={'email': key})
        if 'Item' in existing:
            created_at = existing['Item'].get('createdAt', now)
            # Increment statement count
            body['statementCount'] = int(existing['Item'].get('statementCount', 0)) + 1
    except ClientError:
        pass

    item = {
        'email': key,
        'bankSlug': slug,
        'bankName': bank_name,
        'aliases': json.dumps(body.get('aliases', [])),
        'columnHeaders': json.dumps(body.get('columnHeaders', [])),
        'columnMapping': json.dumps(body.get('columnMapping', {})),
        'dateFormats': json.dumps(body.get('dateFormats', [])),
        'interestPatterns': json.dumps(body.get('interestPatterns', [])),
        'feePatterns': json.dumps(body.get('feePatterns', [])),
        'openingBalanceMethod': body.get('openingBalanceMethod', 'first_transaction'),
        'openingBalancePattern': body.get('openingBalancePattern', ''),
        'transactionOrder': body.get('transactionOrder', 'chronological'),
        'multiPageRepeatRow': body.get('multiPageRepeatRow', ''),
        'closingMarkers': json.dumps(body.get('closingMarkers', [])),
        'currency': body.get('currency', 'KES'),
        'statementCount': body.get('statementCount', 0),
        'createdAt': created_at,
        'updatedAt': now,
    }

    try:
        table.put_item(Item=item)
        return response(200, _parse_template_item(item))
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to save bank template.'})


def handle_delete_bank_template(slug):
    """Delete a bank template by slug."""
    key = f'banktemplate#{slug}'
    try:
        table.delete_item(Key={'email': key})
        return response(200, {'deleted': True, 'slug': slug})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to delete bank template.'})


# --- Integration Config ---

STRIPE_FIELDS = ['publishableKey', 'secretKey', 'basicPriceId', 'proPriceId', 'webhookSecret']
MPESA_FIELDS = ['consumerKey', 'consumerSecret', 'shortcode', 'passkey', 'environment', 'callbackUrl']
PESAPAL_FIELDS = ['consumerKey', 'consumerSecret', 'ipnUrl', 'environment']
PESAPAL_SENSITIVE_FIELDS = {'consumerKey', 'consumerSecret'}

PROVIDER_CONFIG = {
    'stripe': {
        'fields': STRIPE_FIELDS,
        'sensitive': STRIPE_SENSITIVE_FIELDS,
        'configured_check': lambda item: bool(item.get('publishableKey') and item.get('basicPriceId') and item.get('proPriceId')),
    },
    'mpesa': {
        'fields': MPESA_FIELDS,
        'sensitive': MPESA_SENSITIVE_FIELDS,
        'configured_check': lambda item: bool(item.get('consumerKey') and item.get('consumerSecret') and item.get('shortcode')),
    },
    'pesapal': {
        'fields': PESAPAL_FIELDS,
        'sensitive': PESAPAL_SENSITIVE_FIELDS,
        'configured_check': lambda item: bool(item.get('consumerKey') and item.get('consumerSecret')),
    },
}


def handle_get_config(provider):
    """Return integration config, masking sensitive fields."""
    key = f'config#{provider}'
    prov = PROVIDER_CONFIG.get(provider)
    if not prov:
        return response(400, {'error': f'Unknown provider: {provider}'})
    sensitive = prov['sensitive']

    try:
        result = table.get_item(Key={'email': key})
        item = result.get('Item')
        if not item:
            return response(200, {'provider': provider, 'configured': False, 'config': {}})

        config = {}
        for k, v in item.items():
            if k == 'email':
                continue
            if k in sensitive:
                config[k] = mask_value(v) if v else ''
            else:
                config[k] = v

        configured = prov['configured_check'](item)
        return response(200, {'provider': provider, 'configured': configured, 'config': config})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': f'Failed to fetch {provider} config.'})


def handle_save_config(provider, body):
    """Save integration config. Merges with existing to preserve unchanged sensitive fields."""
    key = f'config#{provider}'
    prov = PROVIDER_CONFIG.get(provider)
    if not prov:
        return response(400, {'error': f'Unknown provider: {provider}'})
    sensitive = prov['sensitive']
    fields = prov['fields']

    # Fetch existing item to preserve sensitive fields sent as masked
    try:
        existing = table.get_item(Key={'email': key}).get('Item', {})
    except ClientError:
        existing = {}

    item = {'email': key, 'updatedAt': now_iso()}

    for field in fields:
        value = (body.get(field) or '').strip()
        if field in sensitive:
            # If the value looks masked (contains ****), keep the existing value
            if '****' in value or not value:
                item[field] = existing.get(field, '')
            else:
                item[field] = value
        else:
            item[field] = value

    try:
        table.put_item(Item=item)
        # Return config with sensitive fields masked
        result_config = {}
        for k, v in item.items():
            if k == 'email':
                continue
            if k in sensitive:
                result_config[k] = mask_value(v) if v else ''
            else:
                result_config[k] = v

        configured = prov['configured_check'](item)
        return response(200, {'provider': provider, 'configured': configured, 'config': result_config})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': f'Failed to save {provider} config.'})


def handle_get_public_config():
    """Return non-sensitive payment config for frontend use (Stripe PK, price IDs)."""
    result_data = {'stripe': {'configured': False}, 'mpesa': {'configured': False}, 'pesapal': {'configured': False}}
    try:
        stripe_item = table.get_item(Key={'email': 'config#stripe'}).get('Item')
        if stripe_item:
            result_data['stripe'] = {
                'configured': bool(stripe_item.get('publishableKey') and stripe_item.get('basicPriceId') and stripe_item.get('proPriceId')),
                'publishableKey': stripe_item.get('publishableKey', ''),
                'basicPriceId': stripe_item.get('basicPriceId', ''),
                'proPriceId': stripe_item.get('proPriceId', ''),
            }
    except ClientError:
        pass

    try:
        mpesa_item = table.get_item(Key={'email': 'config#mpesa'}).get('Item')
        if mpesa_item:
            result_data['mpesa'] = {
                'configured': bool(mpesa_item.get('consumerKey') and mpesa_item.get('consumerSecret') and mpesa_item.get('shortcode')),
                'shortcode': mpesa_item.get('shortcode', ''),
                'environment': mpesa_item.get('environment', 'sandbox'),
            }
    except ClientError:
        pass

    try:
        pesapal_item = table.get_item(Key={'email': 'config#pesapal'}).get('Item')
        if pesapal_item:
            result_data['pesapal'] = {
                'configured': bool(pesapal_item.get('consumerKey') and pesapal_item.get('consumerSecret')),
                'environment': pesapal_item.get('environment', 'sandbox'),
            }
    except ClientError:
        pass

    return response(200, result_data)


# --- PesaPal API Helpers ---

_pesapal_token_cache = {}  # {env: {'token': str, 'expires': float}}


def _pesapal_base_url(env):
    if env == 'production':
        return 'https://pay.pesapal.com/v3'
    return 'https://cybqa.pesapal.com/pesapalv3'


def pesapal_get_token(key, secret, env='production'):
    """Get PesaPal auth token, cached for 4 minutes."""
    cached = _pesapal_token_cache.get(env)
    if cached and cached['expires'] > time.time():
        return cached['token']

    url = f'{_pesapal_base_url(env)}/api/Auth/RequestToken'
    payload = json.dumps({'consumer_key': key, 'consumer_secret': secret}).encode()
    req = urllib.request.Request(url, data=payload, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    token = data.get('token')
    if not token:
        raise Exception(f'PesaPal auth failed: {data}')
    _pesapal_token_cache[env] = {'token': token, 'expires': time.time() + 240}
    return token


def pesapal_register_ipn(token, callback_url, env='production'):
    """Register IPN URL with PesaPal, returns ipn_id."""
    url = f'{_pesapal_base_url(env)}/api/URLSetup/RegisterIPN'
    payload = json.dumps({
        'url': callback_url,
        'ipn_notification_type': 'GET',
    }).encode()
    req = urllib.request.Request(url, data=payload, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    return data.get('ipn_id')


def pesapal_submit_order(token, order, env='production'):
    """Submit order to PesaPal, returns redirect_url and order_tracking_id."""
    url = f'{_pesapal_base_url(env)}/api/Transactions/SubmitOrderRequest'
    payload = json.dumps(order).encode()
    req = urllib.request.Request(url, data=payload, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    return data


def pesapal_get_transaction_status(token, order_tracking_id, env='production'):
    """Get transaction status from PesaPal."""
    url = f'{_pesapal_base_url(env)}/api/Transactions/GetTransactionStatus?orderTrackingId={order_tracking_id}'
    req = urllib.request.Request(url, headers={
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': f'Bearer {token}',
    })
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read().decode())
    return data


# --- PesaPal Transaction Handlers ---

def handle_pesapal_create_order(body):
    """Create a PesaPal payment order and return redirect URL."""
    email = body.get('email', '').strip()
    plan_id = body.get('plan', '').strip()
    if not email or not plan_id:
        return response(400, {'error': 'email and plan are required'})

    # Get PesaPal config
    try:
        pp_item = table.get_item(Key={'email': 'config#pesapal'}).get('Item')
        if not pp_item or not pp_item.get('consumerKey') or not pp_item.get('consumerSecret'):
            return response(400, {'error': 'PesaPal is not configured'})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to read PesaPal config'})

    consumer_key = pp_item['consumerKey']
    consumer_secret = pp_item['consumerSecret']
    env = pp_item.get('environment', 'production')
    ipn_url = pp_item.get('ipnUrl', '')

    try:
        token = pesapal_get_token(consumer_key, consumer_secret, env)
    except Exception as e:
        print(f'PesaPal token error: {e}')
        return response(500, {'error': 'Failed to authenticate with PesaPal'})

    # Lazy-register IPN if not stored yet
    ipn_id = pp_item.get('ipnId', '')
    if not ipn_id and ipn_url:
        try:
            ipn_id = pesapal_register_ipn(token, ipn_url, env)
            if ipn_id:
                table.update_item(
                    Key={'email': 'config#pesapal'},
                    UpdateExpression='SET ipnId = :val',
                    ExpressionAttributeValues={':val': ipn_id},
                )
        except Exception as e:
            print(f'PesaPal IPN registration error: {e}')

    # Determine price from plans config
    try:
        plans_item = table.get_item(Key={'email': 'config#plans'}).get('Item')
        plans_list = json.loads(plans_item['plans']) if plans_item and plans_item.get('plans') else []
    except (ClientError, json.JSONDecodeError):
        plans_list = []

    price = 0
    currency = 'USD'
    plan_name = plan_id.capitalize()
    for p in plans_list:
        if p.get('id') == plan_id:
            price = p.get('price', 0)
            currency = p.get('currency', 'USD')
            plan_name = p.get('name', plan_name)
            break
    else:
        # Fallback defaults
        if plan_id == 'basic':
            price = 9
        elif plan_id == 'pro':
            price = 29

    if price <= 0:
        return response(400, {'error': 'Invalid plan or zero price'})

    order_tracking_id = f'IKO-{plan_id}-{int(time.time())}-{secrets.token_hex(4)}'

    order = {
        'id': order_tracking_id,
        'currency': currency,
        'amount': price,
        'description': f'IKO CFO {plan_name} Plan Subscription',
        'callback_url': f'{body.get("returnUrl", "https://ikocfo.com/pricing")}?pesapal_return=true',
        'notification_id': ipn_id,
        'billing_address': {
            'email_address': email,
            'first_name': body.get('firstName', ''),
            'last_name': body.get('lastName', ''),
        },
    }

    try:
        result = pesapal_submit_order(token, order, env)
    except Exception as e:
        print(f'PesaPal submit order error: {e}')
        return response(500, {'error': 'Failed to create PesaPal order'})

    redirect_url = result.get('redirect_url')
    pp_order_tracking_id = result.get('order_tracking_id', order_tracking_id)

    if not redirect_url:
        print(f'PesaPal submit order unexpected response: {result}')
        return response(500, {'error': 'PesaPal did not return a redirect URL'})

    # Store pending transaction
    try:
        table.put_item(Item={
            'email': f'pesapal_txn#{pp_order_tracking_id}',
            'userEmail': email,
            'plan': plan_id,
            'amount': str(price),
            'currency': currency,
            'status': 'pending',
            'createdAt': now_iso(),
        })
    except ClientError as e:
        print(f'DynamoDB error storing txn: {e}')

    return response(200, {
        'redirect_url': redirect_url,
        'order_tracking_id': pp_order_tracking_id,
    })


def _pesapal_complete_transaction(order_tracking_id):
    """Check PesaPal status and upgrade user if payment completed. Returns status dict."""
    # Get transaction record
    try:
        txn = table.get_item(Key={'email': f'pesapal_txn#{order_tracking_id}'}).get('Item')
        if not txn:
            return {'status': 'not_found', 'message': 'Transaction not found'}
    except ClientError:
        return {'status': 'error', 'message': 'Database error'}

    if txn.get('status') == 'Completed':
        return {'status': 'Completed', 'plan': txn.get('plan')}

    # Get PesaPal config
    try:
        pp_item = table.get_item(Key={'email': 'config#pesapal'}).get('Item')
        if not pp_item:
            return {'status': 'error', 'message': 'PesaPal not configured'}
    except ClientError:
        return {'status': 'error', 'message': 'Database error'}

    env = pp_item.get('environment', 'production')
    try:
        token = pesapal_get_token(pp_item['consumerKey'], pp_item['consumerSecret'], env)
        status_data = pesapal_get_transaction_status(token, order_tracking_id, env)
    except Exception as e:
        print(f'PesaPal status check error: {e}')
        return {'status': 'error', 'message': 'Failed to check status with PesaPal'}

    # PesaPal status_code: 0=INVALID, 1=COMPLETED, 2=FAILED, 3=REVERSED
    payment_status_code = status_data.get('payment_status_code') or status_data.get('status_code')
    payment_status = 'pending'
    if payment_status_code == 1:
        payment_status = 'Completed'
    elif payment_status_code == 2:
        payment_status = 'Failed'
    elif payment_status_code == 3:
        payment_status = 'Reversed'

    # Update transaction record
    try:
        table.update_item(
            Key={'email': f'pesapal_txn#{order_tracking_id}'},
            UpdateExpression='SET #s = :s, updatedAt = :u, paymentMethod = :pm, confirmationCode = :cc',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':s': payment_status,
                ':u': now_iso(),
                ':pm': status_data.get('payment_method', ''),
                ':cc': status_data.get('confirmation_code', ''),
            },
        )
    except ClientError as e:
        print(f'DynamoDB error updating txn: {e}')

    # Upgrade user plan if completed
    if payment_status == 'Completed':
        user_email = txn.get('userEmail')
        plan_id = txn.get('plan')
        if user_email and plan_id:
            try:
                table.update_item(
                    Key={'email': user_email},
                    UpdateExpression='SET #p = :p, planUpdatedAt = :u',
                    ExpressionAttributeNames={'#p': 'plan'},
                    ExpressionAttributeValues={':p': plan_id, ':u': now_iso()},
                )
            except ClientError as e:
                print(f'DynamoDB error upgrading user plan: {e}')

    return {'status': payment_status, 'plan': txn.get('plan')}


def handle_pesapal_ipn(query_params):
    """Handle PesaPal IPN callback (GET with OrderTrackingId)."""
    order_tracking_id = query_params.get('OrderTrackingId', '')
    if not order_tracking_id:
        return response(400, {'error': 'OrderTrackingId is required'})

    result = _pesapal_complete_transaction(order_tracking_id)
    return response(200, result)


def handle_pesapal_check_status(query_params):
    """Frontend polls this to check payment status after returning from PesaPal."""
    order_tracking_id = query_params.get('orderTrackingId', '')
    if not order_tracking_id:
        return response(400, {'error': 'orderTrackingId is required'})

    result = _pesapal_complete_transaction(order_tracking_id)
    return response(200, result)


# --- Pricing Plans Config ---

DEFAULT_PLANS = [
    {
        'id': 'free',
        'name': 'Free',
        'price': 0,
        'currency': 'USD',
        'interval': 'month',
        'statements': 1,
        'maxRows': 1000,
        'xirr': False,
        'pdfExport': False,
        'description': 'Try the basics',
        'features': ['1 statement per month', 'Up to 1,000 rows', 'Basic overdraft analysis', 'Column auto-detection'],
    },
    {
        'id': 'basic',
        'name': 'Basic',
        'price': 9,
        'currency': 'USD',
        'interval': 'month',
        'statements': 10,
        'maxRows': 5000,
        'xirr': True,
        'pdfExport': True,
        'description': 'For regular auditing',
        'features': ['10 statements per month', 'Up to 5,000 rows', 'XIRR calculations', 'PDF export', 'Cost-ratio analysis'],
    },
    {
        'id': 'pro',
        'name': 'Pro',
        'price': 29,
        'currency': 'USD',
        'interval': 'month',
        'statements': 0,
        'maxRows': 0,
        'xirr': True,
        'pdfExport': True,
        'description': 'Unlimited power',
        'features': ['Unlimited statements', 'Unlimited rows', 'XIRR calculations', 'PDF export', 'Cost-ratio analysis', 'Priority support'],
    },
]


def handle_get_plans():
    """Return pricing plans. Fetches from DynamoDB or returns defaults."""
    key = 'config#plans'
    try:
        result = table.get_item(Key={'email': key})
        item = result.get('Item')
        if item and item.get('plans'):
            plans = json.loads(item['plans']) if isinstance(item.get('plans'), str) else item.get('plans')
            return response(200, {'plans': plans})
    except ClientError:
        pass
    return response(200, {'plans': DEFAULT_PLANS})


def handle_save_plans(body):
    """Save pricing plans to DynamoDB."""
    plans = body.get('plans')
    if not plans or not isinstance(plans, list):
        return response(400, {'error': 'Plans array is required.'})

    # Validate each plan has required fields
    for plan in plans:
        if not plan.get('id') or not plan.get('name'):
            return response(400, {'error': 'Each plan must have an id and name.'})

    try:
        table.put_item(Item={
            'email': 'config#plans',
            'plans': json.dumps(plans),
            'updatedAt': now_iso(),
        })
        return response(200, {'plans': plans})
    except ClientError as e:
        print(f'DynamoDB error: {e}')
        return response(500, {'error': 'Failed to save plans.'})


# --- Password Reset Handlers ---

def handle_forgot_password(body):
    email = (body.get('email') or '').lower().strip()
    if not email:
        return response(400, {'error': 'Email is required.'})

    generic_msg = 'If an account exists, a reset code has been sent.'

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(200, {'message': generic_msg})

    if 'Item' not in result:
        return response(200, {'message': generic_msg})

    user = result['Item']
    code = generate_code()
    expires = int(time.time()) + 900  # 15 minutes

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET resetCode = :c, resetCodeExpiresAt = :e',
        ExpressionAttributeValues={':c': code, ':e': expires},
    )

    otp_result = send_otp(user, code)
    return response(200, {'message': generic_msg, 'otp_channel': otp_result['channel']})


def handle_reset_password(body):
    email = (body.get('email') or '').lower().strip()
    code = (body.get('code') or '').strip()
    new_password = body.get('new_password', '')

    if not email or not code or not new_password:
        return response(400, {'error': 'Email, code, and new password are required.'})

    if len(new_password) < 8:
        return response(400, {'error': 'Password must be at least 8 characters.'})

    try:
        result = table.get_item(Key={'email': email})
    except ClientError:
        return response(500, {'error': 'Database error.'})

    if 'Item' not in result:
        return response(400, {'error': 'Invalid or expired reset code.'})

    user = result['Item']

    if user.get('resetCode') != code:
        return response(400, {'error': 'Invalid or expired reset code.'})

    if int(user.get('resetCodeExpiresAt', 0)) < int(time.time()):
        return response(400, {'error': 'Reset code has expired. Please request a new one.'})

    table.update_item(
        Key={'email': email},
        UpdateExpression='SET password_hash = :p REMOVE resetCode, resetCodeExpiresAt',
        ExpressionAttributeValues={':p': hash_password(new_password)},
    )

    return response(200, {'message': 'Password has been reset successfully.'})


# --- Main Handler ---

def lambda_handler(event, context):
    method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method', '')
    path = event.get('path') or event.get('rawPath', '')

    # Handle CORS preflight
    if method == 'OPTIONS':
        return response(200, {})

    body = {}
    if event.get('body'):
        try:
            body = json.loads(event['body'])
        except (json.JSONDecodeError, TypeError):
            body = {}

    query_params = event.get('queryStringParameters') or {}

    # --- Auth routes ---
    if method == 'POST' and path == '/auth/register':
        return handle_register(body)

    if method == 'POST' and path == '/auth/verify':
        return handle_verify(body)

    if method == 'POST' and path == '/auth/login':
        return handle_login(body)

    if method == 'POST' and path == '/auth/resend':
        return handle_resend(body)

    if method == 'POST' and path == '/auth/forgot-password':
        return handle_forgot_password(body)

    if method == 'POST' and path == '/auth/reset-password':
        return handle_reset_password(body)

    # --- MFA routes ---
    if method == 'POST' and path == '/auth/mfa/totp/setup':
        return handle_mfa_totp_setup(body)

    if method == 'POST' and path == '/auth/mfa/totp/verify-setup':
        return handle_mfa_totp_verify_setup(body)

    if method == 'POST' and path == '/auth/mfa/totp/disable':
        return handle_mfa_totp_disable(body)

    if method == 'POST' and path == '/auth/mfa/verify':
        return handle_mfa_verify(body)

    if method == 'POST' and path == '/auth/mfa/status':
        return handle_mfa_status(body)

    if method == 'POST' and path == '/auth/mfa/recovery-codes/regenerate':
        return handle_mfa_recovery_regenerate(body)

    # --- WebAuthn routes ---
    if method == 'POST' and path == '/auth/mfa/webauthn/register-options':
        return handle_webauthn_register_options(body)

    if method == 'POST' and path == '/auth/mfa/webauthn/register-verify':
        return handle_webauthn_register_verify(body)

    if method == 'POST' and path == '/auth/mfa/webauthn/auth-options':
        return handle_webauthn_auth_options(body)

    if method == 'POST' and path == '/auth/mfa/webauthn/auth-verify':
        return handle_webauthn_auth_verify(body)

    if method == 'POST' and path == '/auth/mfa/webauthn/remove':
        return handle_webauthn_remove(body)

    # --- Admin routes ---
    if method == 'GET' and path == '/admin/users':
        return handle_admin_users()

    if method == 'GET' and path == '/admin/stats':
        return handle_admin_stats()

    if method == 'POST' and path == '/admin/send-credentials':
        return handle_send_credentials(body)

    if method == 'POST' and path == '/admin/send-mfa-reminders':
        return handle_send_mfa_reminders(body)

    if method == 'POST' and path == '/admin/invite':
        return handle_admin_invite(body)

    if method == 'POST' and path == '/auth/accept-invite':
        return handle_accept_invite(body)

    # /admin/users/{email}/edit
    if method == 'PUT' and '/admin/users/' in path and path.endswith('/edit'):
        parts = path.split('/')
        email = unquote(parts[-2])
        return handle_admin_edit_user(email, body)

    # DELETE /admin/users/{email}
    if method == 'DELETE' and '/admin/users/' in path and not path.endswith('/status') and not path.endswith('/role') and not path.endswith('/edit'):
        parts = path.split('/')
        email = unquote(parts[-1])
        return handle_admin_delete_user(email)

    # /admin/users/{email}/status
    if method == 'PUT' and '/admin/users/' in path and path.endswith('/status'):
        parts = path.split('/')
        email = unquote(parts[-2])
        return handle_admin_user_status(email, body)

    # /admin/users/{email}/role
    if method == 'PUT' and '/admin/users/' in path and path.endswith('/role'):
        parts = path.split('/')
        email = unquote(parts[-2])
        return handle_admin_user_role(email, body)

    # --- Bank rates routes ---
    if method == 'GET' and path == '/admin/bank-rates':
        return handle_get_bank_rates()

    if method == 'POST' and path == '/admin/bank-rates':
        return handle_add_bank_rate(body)

    # PUT /admin/bank-rates/{id}
    if method == 'PUT' and '/admin/bank-rates/' in path:
        rate_id = path.split('/')[-1]
        return handle_update_bank_rate(rate_id, body)

    # DELETE /admin/bank-rates/{id}
    if method == 'DELETE' and '/admin/bank-rates/' in path:
        rate_id = path.split('/')[-1]
        return handle_delete_bank_rate(rate_id)

    # --- Bank template routes ---
    if method == 'GET' and path == '/admin/bank-templates':
        return handle_get_bank_templates()

    if method == 'POST' and path == '/admin/bank-templates':
        return handle_save_bank_template(body)

    # GET /admin/bank-templates/{slug}
    if method == 'GET' and '/admin/bank-templates/' in path:
        slug = path.split('/')[-1]
        return handle_get_bank_template(slug)

    # DELETE /admin/bank-templates/{slug}
    if method == 'DELETE' and '/admin/bank-templates/' in path:
        slug = path.split('/')[-1]
        return handle_delete_bank_template(slug)

    # --- Integration config routes ---
    if method == 'GET' and path == '/config/payment':
        return handle_get_public_config()

    if method == 'GET' and path == '/admin/config/stripe':
        return handle_get_config('stripe')

    if method == 'GET' and path == '/admin/config/mpesa':
        return handle_get_config('mpesa')

    if method == 'PUT' and path == '/admin/config/stripe':
        return handle_save_config('stripe', body)

    if method == 'PUT' and path == '/admin/config/mpesa':
        return handle_save_config('mpesa', body)

    if method == 'GET' and path == '/admin/config/pesapal':
        return handle_get_config('pesapal')

    if method == 'PUT' and path == '/admin/config/pesapal':
        return handle_save_config('pesapal', body)

    # --- PesaPal payment routes ---
    if method == 'POST' and path == '/pesapal/create-order':
        return handle_pesapal_create_order(body)

    if method == 'GET' and path == '/pesapal/ipn':
        return handle_pesapal_ipn(query_params)

    if method == 'GET' and path == '/pesapal/status':
        return handle_pesapal_check_status(query_params)

    # --- Pricing plans routes ---
    if method == 'GET' and path == '/config/plans':
        return handle_get_plans()

    if method == 'PUT' and path == '/admin/config/plans':
        return handle_save_plans(body)

    return response(404, {'error': 'Not found'})

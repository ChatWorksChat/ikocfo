"""
IKO CFO Auth & Admin API — Lambda handler
Endpoints: /auth/register, /auth/verify, /auth/login, /auth/resend
           /auth/mfa/* (TOTP setup, verify, disable, recovery codes)
           /admin/users, /admin/users/{email}/status, /admin/users/{email}/role
           /admin/stats, /admin/send-credentials
"""

import json
import hashlib
import hmac
import os
import random
import string
import struct
import base64
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import unquote

import boto3
from botocore.exceptions import ClientError

# --- Configuration ---

TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'ikocfo-users')
SES_SENDER = os.environ.get('SES_SENDER', 'administrator@forwardsflow.com')
SES_REGION = os.environ.get('SES_REGION', 'eu-west-1')
PASSWORD_SALT = os.environ.get('PASSWORD_SALT', 'ikocfo-salt-2024')

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)
ses = boto3.client('ses', region_name=SES_REGION)

# --- Helpers ---

def response(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
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


def send_credentials_email(email, password):
    subject = 'IKO CFO — Your Admin Account Credentials'
    body = f"""Hello,

Your IKO CFO admin account has been created.

Email: {email}
Password: {password}

Please log in at https://ikocfo.com/login and change your password.

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
  <p>Please <a href="https://ikocfo.com/login" style="color: #8458a3;">log in</a> and change your password.</p>
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

    if not email or not password:
        return response(400, {'error': 'Email and password are required.'})

    if len(password) < 8:
        return response(400, {'error': 'Password must be at least 8 characters.'})

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

    table.put_item(Item=item)
    send_verification_email(email, code)

    return response(201, {'email': email, 'message': 'Verification code sent.'})


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
        'mfaEnabled': bool(user.get('mfaTotpEnabled')),
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

    # Check if MFA is enabled
    if user.get('mfaTotpEnabled'):
        mfa_token = create_mfa_token(email)
        return response(200, {
            'mfaRequired': True,
            'mfaToken': mfa_token,
            'methods': ['totp'],
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
        not user.get('mfaTotpEnabled')
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

    send_verification_email(email, code)

    return response(200, {'message': 'New verification code sent.'})


# --- Admin Handlers ---

def handle_admin_users():
    try:
        result = table.scan()
        users = []
        for item in result.get('Items', []):
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

    return response(200, {
        'totpEnabled': bool(user.get('mfaTotpEnabled')),
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

    # --- Auth routes ---
    if method == 'POST' and path == '/auth/register':
        return handle_register(body)

    if method == 'POST' and path == '/auth/verify':
        return handle_verify(body)

    if method == 'POST' and path == '/auth/login':
        return handle_login(body)

    if method == 'POST' and path == '/auth/resend':
        return handle_resend(body)

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

    # --- Admin routes ---
    if method == 'GET' and path == '/admin/users':
        return handle_admin_users()

    if method == 'GET' and path == '/admin/stats':
        return handle_admin_stats()

    if method == 'POST' and path == '/admin/send-credentials':
        return handle_send_credentials(body)

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

    return response(404, {'error': 'Not found'})

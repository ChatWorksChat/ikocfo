"""
IKO CFO Auth & Admin API — Lambda handler
Endpoints: /auth/register, /auth/verify, /auth/login, /auth/resend
           /admin/users, /admin/users/{email}/status, /admin/users/{email}/role
           /admin/stats, /admin/send-credentials
"""

import json
import hashlib
import hmac
import os
import random
import string
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

    # Update last login
    table.update_item(
        Key={'email': email},
        UpdateExpression='SET lastLoginAt = :t',
        ExpressionAttributeValues={':t': now_iso()},
    )

    # Return user object (without sensitive fields)
    user_data = {
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
    }

    return response(200, {'user': user_data})


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
